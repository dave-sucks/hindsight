/**
 * hero-case.ts — real decisions, replayed against the real model and scored
 * by code (docs/plans/AGENT_ARCHITECTURE.md, step 2).
 *
 *   npx tsx --env-file=.env.local scripts/hero-case.ts <case> [--runs 6]
 *   npx tsx --env-file=.env.local scripts/hero-case.ts --all [--runs 6]
 *   … [--written out.jsonl]  also append what each run wrote for the
 *                            owner (narration + shown text fields), for
 *                            scripts/voice-count.ts. Scoring is unchanged.
 *   … [--inputs-only]        save what each case is shown beside --written, and
 *                            call no model (for scripts/yardstick-regrade.ts).
 *   … [--live-search]        web_search runs for real (Sonar, today's news,
 *                            about $0.006 a search); every other call stays a stub.
 *   cases: scripts/hero-cases/*.json  (cut from real runs by hero-case-from-run.ts)
 *
 * Each case is a recorded conversation up to one decision. The system prompt
 * is built by TODAY'S code from the case's inputs, so a prompt, setup or
 * tool change shows up here. The model gets ONE turn, several times, because
 * one run of a model proves nothing. The tools are described to it and never
 * run: nothing is executed, nothing touches the database or the account.
 *
 * A case may name read-only tools that run for real (`execute`): they read
 * the account as it is today, through the tool's own code, so a case can
 * check what a read returns. Nothing that writes can be named.
 *
 * A case names the decision the right answer makes (`expect`), and a run
 * passes when the turn's tool calls and text match it:
 *   call:  at least one of these calls is made (any one of the list)
 *   never: none of these calls is made
 *   text / neverText: the turn's prose does / does not match a pattern
 * A `where` names fields of the call's input by path ("edit_triggers.*.level",
 * "scoring.$sum") and what each must be: "present", "absent", a value, or
 * { lt, gt, regex }. Not in CI; the pass rate is read by a person and
 * recorded with the PR, before and after a change.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { MODES } from "@/lib/agent/modes";
import { buildPrincipalSystemPrompt } from "@/lib/agent/system-prompts/chat";
import { bookText } from "@/lib/agent/book";
import { recordFor, stockFromRead, triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";
import { setupChecklist } from "@/lib/agent/knowledge/setup-checklist";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";
import { dailyRunRequest } from "@/lib/agent/system-prompt";
import { createResearchTools } from "@/lib/agent/tools";
import { makeSubmitThesisTool, writerRecordFor, writerRequest } from "@/lib/agent/run-thesis-writer";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import { cachedSystem, cachedTools } from "@/lib/agent/prompt-cache";
import { prisma } from "@/lib/prisma";
import { isMarketOpen } from "@/lib/market-hours";
import { grade } from "@/lib/agent/yardstick/grade";
import { score, type Call, type Expect } from "@/lib/agent/yardstick/action";

interface HeroCase {
  what: string;
  lookFor: string;
  expect?: Expect;
  /** The yardstick's labels (lib/agent/yardstick/grade.ts): the playbooks a right answer may name, "none" for none, with why. */
  grade?: { playbooks?: string[]; why?: string };
  /**
   * The stock the case is about. A morning run answers several stocks and
   * may take another first; with this set, the turn is repeated (up to
   * `maxTurns`, default 3) with every call answered by a stub reply until
   * the model updates, trades or dispatches on this stock. Nothing is run.
   */
  scoreOn?: { ticker?: string; thesisId?: string };
  maxTurns?: number;
  /**
   * Read-only tools that run for real when the model calls them (only those
   * in READS). With this set the turn is repeated until the model answers
   * without a call, up to `maxTurns`; other calls get the stub reply.
   */
  execute?: string[];
  /** The run the case was cut from: an executed read runs as its owner, on its account. */
  source?: { runId?: string };
  mode: "principal" | "tactical" | "thesis-writer" | "research-run";
  runMode: string;
  promptArgs: Record<string, unknown>;
  toolCtx: Record<string, unknown>;
  messages: ModelMessage[];
}

const DECIDING = new Set(["update_thesis", "place_trade", "close_position", "manage_position", "dispatch_thesis_research"]);

function isOn(call: Call, on: NonNullable<HeroCase["scoreOn"]>): boolean {
  const a = (call.input ?? {}) as Record<string, unknown>;
  const t = String(a.ticker ?? a.symbol ?? "").toUpperCase();
  return (on.ticker != null && t === on.ticker.toUpperCase()) || (on.thesisId != null && a.thesis_id === on.thesisId);
}

/** The tools a case may run for real: each only reads. */
const READS = new Set(["get_portfolio_context", "get_theses", "list_proposals", "get_market_context", "get_stock_data", "get_earnings_data", "get_sec_filings", "read_knowledge_library"]);

/** Chat with no analyst selected can't write to a stock (route.ts, UNSCOPED_BLOCKED_WRITES). */
const UNSCOPED_BLOCKED = ["place_trade", "close_position", "manage_position", "record_thesis", "update_thesis"];

/**
 * What code fills in each call before the tool runs (defineTool's fromRun): a
 * trigger fire's stock and the trigger that fired, handed to the tools as
 * tactical-run.ts hands them. A call is graded as the tool receives it.
 */
function codeFills(c: HeroCase): Record<string, () => Record<string, unknown> | null> {
  if (c.mode !== "tactical") return {};
  const p = c.promptArgs as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const saved = (p.savedRow as Record<string, unknown> | undefined) ?? savedRowFromOldCase(p);
  const runStock = { ticker: String(saved.ticker), thesisId: String(saved.id), triggerId: String(p.trigger?.id ?? "") };
  const all = createResearchTools({ runId: "hero-case", userId: "hero", accountId: "hero", runMode: c.runMode, runEnvironment: "PAPER", ...c.toolCtx, runStock } as never) as Record<string, { fromRun?: () => Record<string, unknown> | null }>;
  return Object.fromEntries(Object.entries(all).flatMap(([name, t]) => (t.fromRun ? [[name, t.fromRun]] : [])));
}

/** The mode's tools as the model sees them: description and schema, no execute. */
function describedTools(c: HeroCase): ToolSet {
  if (c.mode === "thesis-writer") {
    // The tools its record names, its save among them. Its web search is left off: the note is written from the recorded data block.
    const submit = makeSubmitThesisTool({ ticker: String(c.promptArgs.ticker) } as never);
    const reads = createResearchTools({ runId: "hero-case", userId: "hero", accountId: "hero", runMode: "THESIS_WRITER", runEnvironment: "PAPER", ...c.toolCtx } as never) as Record<string, { description?: string; inputSchema: unknown; toModelOutput?: unknown }>;
    const named = (name: string) => (name === "submit_thesis" ? { description: submit.description, inputSchema: submit.inputSchema, toModelOutput: undefined } : reads[name]);
    return Object.fromEntries(
      writerRecordFor(writerArgs(c))
        .tools.filter((name) => named(name))
        .map((name) => [name, { description: named(name).description, inputSchema: named(name).inputSchema, toModelOutput: named(name).toModelOutput }]),
    ) as ToolSet;
  }
  const all = createResearchTools({
    runId: "hero-case", userId: "hero", accountId: "hero", runMode: c.runMode, runEnvironment: "PAPER", ...c.toolCtx,
  } as never) as Record<string, { description?: string; inputSchema: unknown; toModelOutput?: unknown }>;
  // A fire's tools are its agent's: the post-trade write-up (promptArgs.autoTrade) has no trade tools, as the live run.
  const allowed = c.mode === "tactical" ? [...recordFor(c.promptArgs as { autoTrade?: { line: string } | null }).tools] : (MODES[c.mode].toolAllowlist ?? Object.keys(all));
  const scoped = c.mode !== "principal" || c.toolCtx.analystId != null;
  return Object.fromEntries(
    allowed
      .filter((name) => all[name] && (scoped || !UNSCOPED_BLOCKED.includes(name)))
      .map((name) => [name, { description: all[name].description, inputSchema: all[name].inputSchema, toModelOutput: all[name].toModelOutput }]),
  ) as ToolSet;
}

type LiveRead = { execute: (input: unknown, opts: { toolCallId: string; messages: ModelMessage[] }) => Promise<unknown>; toModelOutput?: (o: { toolCallId: string; input: unknown; output: unknown }) => unknown };

/**
 * The case's `execute` tools, built as the run's owner on the run's account.
 * Refused while the market is open unless `--live-reads-in-session` is given:
 * a read spends the shared market-data budget the five-minute trigger check
 * has first claim on (quote-budget.ts), and its prices move between runs.
 */
async function liveReads(c: HeroCase, inSession: boolean): Promise<Record<string, LiveRead> | null> {
  // A Writer's reads are the tools its record names besides its save, and they run for real, as in its run.
  const execute = c.mode === "thesis-writer" ? writerRecordFor(writerArgs(c)).tools.filter((name) => name !== "submit_thesis") : (c.execute ?? []);
  if (!execute.length) return null;
  if (isMarketOpen() && !inSession) {
    throw new Error(`the case runs ${execute.join(", ")} for real and the market is open; run it after the close, or pass --live-reads-in-session`);
  }
  for (const name of execute) if (!READS.has(name)) throw new Error(`${name} is not a read; a case can run only ${[...READS].join(", ")}`);
  // A Writer case cut before cases kept their run reads as its analyst's account.
  const analystName = c.mode === "thesis-writer" ? (c.promptArgs as { analyst?: { name?: string } }).analyst?.name : undefined;
  if (!c.source?.runId && !analystName) throw new Error("a case that runs reads needs source.runId");
  const run = c.source?.runId
    ? await prisma.researchRun.findUniqueOrThrow({ where: { id: c.source.runId }, select: { userId: true, accountId: true } })
    : await prisma.agentConfig.findFirstOrThrow({ where: { name: analystName }, select: { userId: true, accountId: true } });
  const all = createResearchTools({
    runId: "hero-case", userId: run.userId, accountId: run.accountId, runMode: c.runMode, runEnvironment: "PAPER", ...c.toolCtx,
  } as never) as unknown as Record<string, LiveRead>;
  return Object.fromEntries(execute.map((name) => [name, all[name]]));
}

/** The words a recorded trigger-run kickoff opens with, before what it asked: the facts of the fire. */
function factsOf(kickoff: ModelMessage | undefined): string | null {
  if (!kickoff || kickoff.role !== "user") return null;
  const text = typeof kickoff.content === "string" ? kickoff.content : kickoff.content.map((p) => ("text" in p ? p.text : "")).join("\n\n");
  const asks = [" Find out what is going on with the company", " Validate, decide"].map((a) => text.indexOf(a)).filter((i) => i > 0);
  return asks.length ? text.slice(0, Math.min(...asks)) : text;
}

/**
 * What a recorded kickoff knew beyond the trigger's sentence: after "Tactical
 * run on $T. <sentence>." (or the write-up's "...: set to Auto, so no
 * analyst decided. <the trade>"), a report's numbers, what fired with it, a
 * refused call. Today's message says the trigger itself, once.
 */
function moreOf(facts: string, autoLine: string | null): string {
  const after = facts.replace(/^(?:Tactical run on|Write-up on) \$[A-Z.]+\. /, "");
  const auto = after.indexOf(": set to Auto, so no analyst decided.");
  if (auto >= 0) {
    const rest = after.slice(auto + ": set to Auto, so no analyst decided.".length);
    return autoLine && rest.trimStart().startsWith(autoLine) ? rest.trimStart().slice(autoLine.length) : rest;
  }
  const end = after.search(/[.!?](?= |$)/);
  return end >= 0 ? after.slice(end + 1).replace(/\s+$/, "") : "";
}

/**
 * When the case happened, for the date line: the start of the run it was
 * cut from, else the Writer's run date, else the newest time in its saved
 * inputs, else now.
 */
async function caseNow(c: HeroCase): Promise<Date> {
  if (c.source?.runId) {
    const run = await prisma.researchRun.findUnique({ where: { id: c.source.runId }, select: { startedAt: true } }).catch(() => null);
    if (run?.startedAt) return run.startedAt;
  }
  const day = typeof c.promptArgs.runDate === "string" ? c.promptArgs.runDate : null;
  if (day) return new Date(`${day}T14:00:00Z`);
  const stamps = JSON.stringify(c.promptArgs).match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g) ?? [];
  return stamps.length ? new Date(stamps.sort().at(-1)!) : new Date();
}

/**
 * The request for a case, built by TODAY'S code: its instructions, and for a
 * Writer, trigger fire or a morning run its first message too (the date line,
 * the reads, then the message); a trigger fire's message from the recorded
 * kickoff's facts, a Writer's data block as the run sent it.
 */
function requestFor(c: HeroCase, now: Date): { system: string; first?: string } {
  if (c.mode === "thesis-writer") {
    // The stock's data as the run sent it; the rest of the first message is today's.
    const r = writerRequest(writerArgs(c), { dataBlock: dataBlockOf(c.messages[0]) }, now);
    return { system: r.instructions, first: r.message };
  }
  if (c.mode === "research-run") {
    const r = morningRequest(c, now);
    return { system: r.instructions, first: r.message };
  }
  if (c.mode !== "tactical") return { system: systemFor(c, now) };
  const args = tacticalArgs(c);
  const r = triggerRunRequest(args, { more: moreOf(factsOf(c.messages[0]) ?? "", args.autoTrade?.line ?? null) }, now);
  return { system: r.instructions, first: r.message };
}

/**
 * A chat case's analyst book, from the watchlist it saved (no beliefs were
 * saved): it rides on the newest message, as the chat's context does.
 */
function chatBookOf(c: HeroCase): string | null {
  const a = c.promptArgs.scopedAnalyst as { watchlist?: string[]; name?: string } | null | undefined;
  if (!a?.watchlist) return null;
  return bookText(a.watchlist.map((ticker) => ({ ticker, status: "WATCHING" as const, analyst: a.name ?? null, belief: null })));
}

/** A recorded Writer message's stock data: what sits between its data heading and its closing ask. */
function dataBlockOf(m: ModelMessage | undefined): string {
  const text = !m ? "" : typeof m.content === "string" ? m.content : m.content.map((p) => ("text" in p ? p.text : "")).join("\n\n");
  const banner = "GROUND-TRUTH DATA — use these numbers; do not invent or contradict\n═══════════════════════════════════════════════════════════════════\n";
  const at = text.indexOf(banner);
  const body = at >= 0 ? text.slice(at + banner.length) : text.replace(/^## GROUND-TRUTH DATA[^\n]*\n/, "");
  return body.replace(/\n\nWrite the research note now, then call submit_thesis\.\s*$/, "");
}

/** A Writer case's inputs, as the Writer reads them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writerArgs(c: HeroCase): any {
  // Cases saved before step 10 carry the analyst's fields loose on the arguments.
  const p = c.promptArgs;
  const analyst = (p.analyst as Record<string, unknown> | undefined) ?? { name: p.analystName, analystPrompt: p.analystPrompt, minConfidence: p.minConfidence, setupIds: p.setupIds };
  // On a refresh, the stock as the Writer reads it: get_theses's short row, built from the thesis the case saved.
  const e = p.existingThesis as { id: string; status: string; direction: string | null; horizon: string | null; coreBelief: string | null; company?: string | null; triggers: Trigger[] } | null;
  const ticker = String(p.ticker).toUpperCase();
  const saved = e ? { id: e.id, ticker, status: e.status, direction: e.direction, horizon: e.horizon, company: e.company ?? null, coreBelief: e.coreBelief, triggers: e.triggers.map((x) => ({ id: x.id, says: sentenceOf(x), rationale: x.rationale })), situations: [] } : null;
  const stockRow = saved ? (stockFromRead({ ok: true, data: { theses: [saved] } }, e!.id)?.row ?? null) : null;
  // The playbooks as an account that hasn't edited them reads them (the catalog's seed).
  return { ...p, analyst, stockRow, setups: setupsForAnalyst(analyst.setupIds as string[]), playbooks: (id: string) => playbookTemplates(null, id) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tacticalArgs(c: HeroCase): any {
  // Cases saved before step 10 carry the analyst as { name, mandate }.
  const p = c.promptArgs as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const a = p.analyst as Record<string, unknown>;
  // The stock as the trigger run reads it: get_theses's saved row (a case
  // saved since step 10), or, for an older case, the row rebuilt from the
  // stock the old prompt was handed.
  const saved = (p.savedRow as Record<string, unknown> | undefined) ?? savedRowFromOldCase(p);
  const stock = stockFromRead({ ok: true, data: { theses: [saved] } }, String(saved.id));
  return {
    analyst: { ...a, analystPrompt: (a.analystPrompt ?? a.mandate ?? null) as string | null },
    stock: { ticker: String(saved.ticker), direction: (saved.direction as string | null) ?? null, row: stock?.row ?? null },
    trigger: p.trigger,
    position: p.position ? { peakPrice: p.position.peakPrice ?? null } : null,
    fired: { price: p.fired?.price ?? null },
    capacity: p.capacity ?? null,
    // A case that names its situations takes their text from today's
    // table, so a recorded case prints the guidance a live run prints.
    // The post-trade write-up writes up the trade; a situation asks for a decision it doesn't make (tactical-run.ts).
    situations: p.autoTrade ? null : p.situations?.guidance ? p.situations : stock?.situations ?? null,
    autoTrade: p.autoTrade ?? null,
  };
}

function systemFor(c: HeroCase, now: Date): string {
  switch (c.mode) {
    case "research-run":
      return morningRequest(c, now).instructions;
    default:
      return buildPrincipalSystemPrompt(c.promptArgs as never);
  }
}

/** A morning case's request, built by today's code from its inputs. */
function morningRequest(c: HeroCase, now: Date) {
  // JSON turned the refusals' dates into strings; the builder wants dates.
  const runInput = c.promptArgs.runInput as { openRefusals?: Array<{ createdAt: string | Date }>; pendingApprovalCount?: number; analyst?: { pendingApprovalCount?: number } };
  for (const r of runInput.openRefusals ?? []) r.createdAt = new Date(r.createdAt);
  // Cases saved before step 10 carry the count on the run input's analyst copy.
  runInput.pendingApprovalCount ??= runInput.analyst?.pendingApprovalCount;
  return dailyRunRequest(c.promptArgs.config as never, runInput as never, now);
}

/**
 * A trigger case saved before step 10 holds the stock as the old prompt's
 * hand-built object; this is the saved get_theses row built from those
 * fields, so the replay reads the row a live trigger run reads. The fire's
 * time was not saved, so the fired rung carries no "fired" mark; the prompt
 * names it with its id in TRIGGER THAT FIRED.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function savedRowFromOldCase(p: Record<string, any>): Record<string, unknown> {
  const t = p.thesis;
  const held = p.position != null;
  return {
    id: t.id, ticker: t.ticker, status: held ? "HOLDING" : "WATCHING", direction: t.direction, horizon: t.horizon, setupId: t.setupId ?? null,
    context: p.context ?? null,
    coreBelief: t.coreBelief, keyAssumptions: t.keyAssumptions, invalidationConds: t.invalidationConds,
    paid: held ? p.position.avgCost : null,
    position: held ? { quantity: p.position.quantity, avgCost: p.position.avgCost, peakPrice: p.position.peakPrice ?? null } : null,
    triggers: ((t.allTriggers ?? []) as Trigger[]).map((x) => ({ id: x.id, says: sentenceOf(x), rationale: x.rationale })),
    snapshot: t.snapshotText ? { text: t.snapshotText } : null,
    bullCase: { bullets: ((t.bullCaseBullets ?? []) as string[]).map((text) => ({ text })) },
    bearCase: { bullets: ((t.bearCaseBullets ?? []) as string[]).map((text) => ({ text })) },
    setup: setupChecklist(t.setupId, t.horizon),
    researchAge: t.researchAge ?? null,
    researchUpdatedAt: t.researchAge?.lastWrittenAt ?? null,
    heldThroughFloor: p.heldThroughFloor ?? null,
    situations: p.situations?.codes ?? [],
  };
}

function brief(call: Call): string {
  const a = (call.input ?? {}) as Record<string, unknown>;
  const keys = Object.keys(a).filter((k) => a[k] !== undefined && a[k] !== null && k !== "rationale" && k !== "notes" && k !== "structural_unchanged_reason");
  const shown = keys.map((k) => {
    const v = a[k];
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `${k}=${s.length > 60 ? s.slice(0, 60) + "…" : s}`;
  });
  return `${call.toolName}(${shown.join(", ")})`;
}

/** The fields whose text the owner reads (lib/agent/voice.ts), per tool. */
const SHOWN: Record<string, string[]> = {
  update_thesis: ["rationale"],
  place_trade: ["entry_rationale"],
  close_position: ["notes"],
  manage_position: ["reason"],
  submit_thesis: ["rationale"],
};

/** What one run wrote that the owner reads: the shown fields, each trigger's note, the summary lines. */
function writtenBy(calls: Call[]): Array<{ tool: string; field: string; text: string }> {
  const out: Array<{ tool: string; field: string; text: string }> = [];
  for (const c of calls) {
    const a = (c.input ?? {}) as Record<string, unknown>;
    for (const f of SHOWN[c.toolName] ?? []) if (typeof a[f] === "string") out.push({ tool: c.toolName, field: f, text: a[f] as string });
    for (const f of ["add_triggers", "edit_triggers", "triggers"]) {
      for (const t of Array.isArray(a[f]) ? (a[f] as Array<Record<string, unknown>>) : []) {
        if (typeof t?.rationale === "string") out.push({ tool: c.toolName, field: `${f}.rationale`, text: t.rationale });
      }
    }
    if (c.toolName === "record_run_summary" && Array.isArray(a.ranked_picks)) {
      for (const p of a.ranked_picks as Array<Record<string, unknown>>) if (typeof p?.reasoning === "string") out.push({ tool: c.toolName, field: "ranked_picks.reasoning", text: p.reasoning });
    }
  }
  return out;
}

async function runCase(name: string, runs: number, writtenPath: string | null, inSession: boolean, liveSearch = false, inputsOnly = false): Promise<{ name: string; passes: number; runs: number; lookFor: string }> {
  const c = JSON.parse(readFileSync(`scripts/hero-cases/${name}.json`, "utf8")) as HeroCase;
  const mode = MODES[c.mode];
  const { system, first } = requestFor(c, await caseNow(c));
  // A trigger fire's or a morning run's first message is today's too; the recorded one is replaced.
  if (first != null) c.messages = [{ role: "user", content: first }, ...c.messages.slice(1)];
  // A chat's analyst book rides on its newest message.
  const book = c.mode === "principal" ? chatBookOf(c) : null;
  const lastUser = c.messages.map((m) => m.role).lastIndexOf("user");
  if (book && lastUser >= 0) {
    const m = c.messages[lastUser];
    const said = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    c.messages[lastUser] = { ...m, content: [{ type: "text", text: book }, ...said] } as ModelMessage;
  }
  const tools = describedTools(c);
  const fills = codeFills(c);
  // What the agent was shown, for the yardstick's grades: its instructions and the conversation it was handed.
  const shown = `${system}\n${JSON.stringify(c.messages)}`;
  // Kept beside the runs, so a saved run can be graded again without a model call (scripts/yardstick-regrade.ts).
  if (writtenPath) {
    mkdirSync(`${dirname(writtenPath)}/inputs`, { recursive: true });
    writeFileSync(`${dirname(writtenPath)}/inputs/${name}.txt`, shown);
  }
  if (inputsOnly) return { name, passes: 0, runs: 0, lookFor: c.lookFor };
  // A recorded tool result is what the model read on the day. Where a tool
  // now hands the model less than the screen (`forModel`), the replay reads
  // what today's model would read — the same as a live run.
  const inputs = new Map<string, unknown>();
  for (const m of c.messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const p of m.content) if (p.type === "tool-call") inputs.set(p.toolCallId, p.input);
  }
  c.messages = await Promise.all(
    c.messages.map(async (m) => {
      if (m.role !== "tool" || !Array.isArray(m.content)) return m;
      const content = await Promise.all(
        m.content.map(async (p) => {
          const hook = p.type === "tool-result" ? (tools[p.toolName] as { toModelOutput?: (o: { toolCallId: string; input: unknown; output: unknown }) => unknown })?.toModelOutput : undefined;
          if (!hook || p.type !== "tool-result") return p;
          const raw = p.output && typeof p.output === "object" && "value" in p.output ? (p.output as { value: unknown }).value : p.output;
          return { ...p, output: (await hook({ toolCallId: p.toolCallId, input: inputs.get(p.toolCallId), output: raw })) as typeof p.output };
        }),
      );
      return { ...m, content } as typeof m;
    }),
  );
  const model = mode.provider === "anthropic" ? anthropic(mode.model) : c.mode === "research-run" ? openai.chat(mode.model) : openai(mode.model);

  console.log(`\n# ${name} — ${mode.model}, ${runs} run${runs === 1 ? "" : "s"}, prompt ${system.length.toLocaleString("en-US")} characters, conversation ${JSON.stringify(c.messages).length.toLocaleString("en-US")}`);
  console.log(c.what);
  console.log(`Look for: ${c.lookFor}`);
  if (c.expect) console.log(`Expect: ${JSON.stringify(c.expect)}`);

  let passes = 0;
  let tokensIn = 0, tokensCached = 0, tokensOut = 0;
  const providerOptions: Parameters<typeof generateText>[0]["providerOptions"] =
    mode.provider === "anthropic"
      ? mode.thinkingBudget != null
        ? { anthropic: { thinking: { type: "enabled", budgetTokens: mode.thinkingBudget } } }
        : undefined
      : { openai: { strictJsonSchema: true, promptCacheKey: `hero-${name}` } };
  // A refused call gets the refusal back and one more turn, as it does in production.
  const live = await liveReads(c, inSession);
  // --live-search: the real web_search, built as the case's run builds it.
  const search = liveSearch
    ? (createResearchTools({ runId: `hero-${name}`, userId: "hero", accountId: "hero", runMode: c.runMode, runEnvironment: "PAPER", ...c.toolCtx } as never) as unknown as Record<string, LiveRead>).web_search
    : null;
  // A Writer that reads gets its record's steps, as in its run, to read and then save.
  const maxTurns = c.scoreOn || live ? (c.maxTurns ?? (c.mode === "thesis-writer" ? writerRecordFor(writerArgs(c)).maxSteps : 3)) : 2;
  for (let i = 1; i <= runs; i++) {
    const messages: ModelMessage[] = [...c.messages];
    const calls: Call[] = [];
    const reads: Array<{ toolName: string; output: unknown }> = [];
    /** What each read the case runs for real handed the model: the grades count it as shown. */
    const readShown: unknown[] = [];
    let text = "";
    let turns = 0;
    /** Calls the SDK could not match to the schema (a missing field, an enum written as a word). */
    const invalid: Array<{ tool: string; error: string }> = [];
    for (let turn = 1; turn <= maxTurns; turn++) {
      turns = turn;
      const result = await generateText({ model, system: cachedSystem(mode.provider, system), messages, tools: cachedTools(mode.provider, tools), stopWhen: stepCountIs(1), providerOptions });
      tokensIn += result.usage.inputTokens ?? 0;
      tokensCached += result.usage.inputTokenDetails?.cacheReadTokens ?? result.usage.cachedInputTokens ?? 0;
      tokensOut += result.usage.outputTokens ?? 0;
      // A call the schema refuses is refused in production too: it never counts toward a pass.
      const turnCalls: Call[] = result.toolCalls
        .filter((t) => !(t as { invalid?: boolean }).invalid)
        .map((t) => ({ toolName: t.toolName, input: { ...(t.input as object), ...(fills[t.toolName]?.() ?? {}) } }));
      const refusals = new Map<string, string>();
      for (const t of result.toolCalls as Array<{ toolCallId: string; toolName: string; invalid?: boolean; error?: unknown; input?: unknown }>) {
        if (!t.invalid) continue;
        // The reason comes after the whole input: keep the reason, and the triggers it was about.
        const msg = String((t.error as Error)?.message ?? t.error);
        const reason = msg.includes("Error message:") ? msg.slice(msg.indexOf("Error message:")) : msg.slice(-700);
        refusals.set(t.toolCallId, msg);
        const input = (t.input ?? {}) as Record<string, unknown>;
        const triggers = Object.fromEntries(["triggers", "add_triggers", "edit_triggers"].filter((k) => input[k] != null).map((k) => [k, input[k]]));
        invalid.push({ tool: t.toolName, error: `${reason.replace(/\s+/g, " ")} — ${JSON.stringify(triggers)}` });
      }
      calls.push(...turnCalls);
      text += (text ? "\n" : "") + result.text;
      // Done when the model answers without a call, or (with scoreOn) decides on the stock.
      // A Writer is done once it calls its save, as its run ends there.
      const decided =
        turnCalls.length === 0 ||
        (c.mode === "thesis-writer" && turnCalls.some((t) => t.toolName === "submit_thesis")) ||
        (c.scoreOn ? turnCalls.some((t) => DECIDING.has(t.toolName) && isOn(t, c.scoreOn!)) : !live);
      if (refusals.size === 0 && (decided || turn >= (c.scoreOn || live ? maxTurns : 1))) break;
      // Not there yet: answer every call and let the model go on. A read the
      // case runs for real gets its real reply, as the model would read it;
      // every other call gets a stub and nothing is run. Ending the run is
      // refused the way complete_run refuses it when a stock on the list has
      // not been answered.
      const left = c.scoreOn?.ticker ?? c.scoreOn?.thesisId ?? "the stock";
      const reply = result.response.messages as ModelMessage[];
      messages.push(...reply);
      // The SDK already answers a refused call with its error; answer each call once.
      const answered = new Set(
        reply.flatMap((m) => (m.role === "tool" ? (m.content as Array<{ toolCallId?: string }>).map((p) => p.toolCallId) : [])),
      );
      const unanswered = result.toolCalls.filter((t) => !answered.has(t.toolCallId));
      if (unanswered.length) messages.push({
        role: "tool",
        content: await Promise.all(unanswered.map(async (t) => {
          const read = live?.[t.toolName] ?? (t.toolName === "web_search" ? search : null);
          if (read && !refusals.has(t.toolCallId)) {
            const output = await read.execute(t.input, { toolCallId: t.toolCallId, messages });
            reads.push({ toolName: t.toolName, output });
            // As it goes over the wire: plain JSON (a date as its string, an undefined field left out).
            const forModel = JSON.parse(JSON.stringify(read.toModelOutput ? await read.toModelOutput({ toolCallId: t.toolCallId, input: t.input, output }) : { type: "json" as const, value: output }));
            readShown.push(forModel);
            return { type: "tool-result" as const, toolCallId: t.toolCallId, toolName: t.toolName, output: forModel as { type: "json"; value: never } };
          }
          return {
            type: "tool-result" as const,
            toolCallId: t.toolCallId,
            toolName: t.toolName,
            output: {
              type: "json" as const,
              value: refusals.has(t.toolCallId)
                ? { ok: false, error: refusals.get(t.toolCallId)! }
                : t.toolName === "complete_run"
                  ? { ok: false, error: `complete_run refused: $${left} is on today's list and has not been answered. Answer it, then call complete_run.` }
                  : { ok: true, summary: "Replay: this call was recorded, not executed." },
            },
          };
        })),
      });
    }
    const verdict = score(c.expect, calls, text, reads);
    if (verdict.pass) passes++;
    console.log(`## run ${i} — ${verdict.pass ? "pass" : `fail: ${verdict.why}`}${turns > 1 ? ` (${turns} turns)` : ""}`);
    if (text.trim()) console.log(text.trim().length > 600 ? text.trim().slice(0, 600) + "…" : text.trim());
    for (const call of calls) console.log(`CALL ${brief(call)}`);
    for (const bad of invalid) console.log(`INVALID ${bad.tool}: ${bad.error}`);
    for (const r of reads) console.log(`READ ${r.toolName}: ${String((r.output as { summary?: string; error?: string })?.summary ?? (r.output as { error?: string })?.error ?? "").slice(0, 240)}`);
    const triggerFields = calls.map((c) => {
      const a = (c.input ?? {}) as Record<string, unknown>;
      return { tool: c.toolName, ...Object.fromEntries(["triggers", "add_triggers", "edit_triggers"].filter((k) => a[k] != null).map((k) => [k, a[k]])) };
    });
    // A read the case runs for real is part of what the run was shown.
    const grades = grade({ calls, narration: text }, readShown.length ? `${shown}\n${JSON.stringify(readShown)}` : shown, c.grade ?? {});
    console.log(`GRADES ${JSON.stringify(grades)}`);
    if (writtenPath) appendFileSync(writtenPath, JSON.stringify({ case: name, run: i, pass: verdict.pass, why: verdict.why, grades, narration: text.trim(), saved: writtenBy(calls), triggerFields, invalid, ...(readShown.length ? { readShown } : {}), calls: calls.map((c) => ({ tool: c.toolName, input: c.input })) }) + "\n");
  }
  console.log(`\n${name}: ${passes}/${runs} pass — tokens in ${tokensIn.toLocaleString("en-US")} (${tokensCached.toLocaleString("en-US")} cached), out ${tokensOut.toLocaleString("en-US")}`);
  return { name, passes, runs, lookFor: c.lookFor };
}

async function main() {
  const args = process.argv.slice(2);
  const runsAt = args.indexOf("--runs");
  const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 6;
  const writtenAt = args.indexOf("--written");
  const writtenPath = writtenAt >= 0 ? args[writtenAt + 1] : null;
  const names = args.includes("--all")
    ? readdirSync("scripts/hero-cases").filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort()
    : args.filter((a) => !a.startsWith("--") && a !== String(runs) && a !== writtenPath);
  if (names.length === 0) throw new Error("usage: hero-case.ts <case>... | --all  [--runs N] [--print]");
  // --print: each case's system prompt, built as a run builds it, and no model call.
  if (args.includes("--print")) {
    for (const name of names) {
      const c = JSON.parse(readFileSync(`scripts/hero-cases/${name}.json`, "utf8")) as HeroCase;
      console.log(`===== ${name} (${c.mode})\n${systemFor(c, await caseNow(c))}`);
    }
    return;
  }
  const results = [];
  const inSession = args.includes("--live-reads-in-session");
  // --inputs-only: save what each case is shown (beside --written) and call no model.
  for (const name of names) results.push(await runCase(name, runs, writtenPath, inSession, args.includes("--live-search"), args.includes("--inputs-only")));
  console.log("\n| Case | Pass | Looks for |\n|---|---|---|");
  for (const r of results) console.log(`| ${r.name} | ${r.passes}/${r.runs} | ${r.lookFor} |`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
