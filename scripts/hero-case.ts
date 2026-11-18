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
 *
 * A case cut with its context (`context`, lib/agent/yardstick/context.ts)
 * sends the facts as the run sent them, put together with today's record.
 * The Portfolio Manager's case runs on until its write-up. The Market
 * Reviewer and the portfolio digest are one call each, sent the way their
 * run files send it (`sent`: the rest of the saved body); the reviewer's web
 * search runs for real, on today's web. Their rules (lib/agent/yardstick/rules.ts)
 * are graded beside the yardstick's grades.
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import OpenAI from "openai";
import { dirname } from "path";
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { MODES } from "@/lib/agent/modes";
import { buildPrincipalSystemPrompt } from "@/lib/agent/system-prompts/chat";
import { recordFor, stockFromRead, triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";
import { setupChecklist } from "@/lib/agent/knowledge/setup-checklist";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";
import { dailyRunRequest } from "@/lib/agent/system-prompt";
import { createResearchTools } from "@/lib/agent/tools";
import { makeSubmitThesisTool, writerRequest } from "@/lib/agent/run-thesis-writer";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import { cachedSystem, cachedTools } from "@/lib/agent/prompt-cache";
import { prisma } from "@/lib/prisma";
import { isMarketOpen } from "@/lib/market-hours";
import { grade } from "@/lib/agent/yardstick/grade";
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { MARKET_REVIEWER } from "@/lib/agent/engine/agents/market-reviewer";
import { MORNING_RUN } from "@/lib/agent/engine/agents/morning-run";
import { PORTFOLIO_DIGEST } from "@/lib/agent/engine/agents/portfolio-digest";
import { PORTFOLIO_MANAGER } from "@/lib/agent/engine/agents/portfolio-manager";
import type { AgentRecord } from "@/lib/agent/engine/types";
import { loadedFrom, type StoredContext } from "@/lib/agent/yardstick/context";
import type { RuleRun } from "@/lib/agent/yardstick/rules";
import { caseRules } from "@/lib/agent/yardstick/case-rules";
import { score, type Call, type Expect } from "@/lib/agent/yardstick/action";

interface HeroCase {
  what: string;
  lookFor: string;
  /** Why the expected answer is the right one: the situation text or the instruction that makes it so. */
  why?: string;
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
  mode: "principal" | "tactical" | "thesis-writer" | "research-run" | "portfolio-manager" | "market-reviewer" | "portfolio-digest";
  runMode: string;
  /** The facts the run was sent, as it sent them (lib/agent/yardstick/context.ts); with `promptArgs.now` and `promptArgs.environment`. */
  context?: StoredContext[];
  /** A one-call agent's saved body, its messages and model left out: what the replay sends beside today's text. */
  sent?: Record<string, unknown>;
  promptArgs: Record<string, unknown>;
  toolCtx: Record<string, unknown>;
  messages: ModelMessage[];
}

const DECIDING = new Set(["update_thesis", "place_trade", "close_position", "manage_position", "dispatch_thesis_research"]);

/** The record a case's context is put together with, by mode. */
const RECORDS: Partial<Record<HeroCase["mode"], AgentRecord>> = {
  "portfolio-manager": PORTFOLIO_MANAGER,
  "market-reviewer": MARKET_REVIEWER,
  "portfolio-digest": PORTFOLIO_DIGEST,
  "research-run": MORNING_RUN,
};
const ONE_CALL = new Set<HeroCase["mode"]>(["market-reviewer", "portfolio-digest"]);
/** The agent's model, and whether it goes through OpenAI's chat API (the morning run's) or its responses API. */
function modelOf(c: HeroCase): { model: string; provider: string; thinkingBudget?: number | null } {
  const record = RECORDS[c.mode];
  if (record && c.mode !== "research-run") return { model: record.model, provider: "openai" };
  return MODES[c.mode as keyof typeof MODES];
}

/** A case's request from its stored context: today's record, the day's facts. Names any block today's record reads that the case lacks. */
function fromContext(c: HeroCase): { system: string; first: string; record: AgentRecord } {
  const record = RECORDS[c.mode];
  if (!record || !c.context) throw new Error(`${c.mode} has no record to put a stored context together with`);
  const { loaded, missing } = loadedFrom(record, c.context);
  if (missing.length) console.log(`note: today's ${record.id} reads ${missing.join(", ")}, which this case doesn't have: sent as none`);
  const p = c.promptArgs as { now?: string; environment?: "PAPER" | "LIVE" };
  const built = composeAgentRequest(record, { now: new Date(p.now ?? Date.now()), environment: p.environment ?? "PAPER" }, loaded);
  return { system: built.instructions, first: built.message, record };
}

/** The rows a recorded get_theses returned, by ticker. */
function recordedRows(c: HeroCase): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const m of c.messages) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const p of m.content) {
      if (p.type !== "tool-result" || p.toolName !== "get_theses") continue;
      const v = (p.output as { value?: { data?: { theses?: Array<Record<string, unknown>> } } })?.value;
      for (const row of v?.data?.theses ?? []) out.set(String(row.ticker).toUpperCase(), row);
    }
  }
  return out;
}

function isOn(call: Call, on: NonNullable<HeroCase["scoreOn"]>): boolean {
  const a = (call.input ?? {}) as Record<string, unknown>;
  const t = String(a.ticker ?? a.symbol ?? "").toUpperCase();
  return (on.ticker != null && t === on.ticker.toUpperCase()) || (on.thesisId != null && a.thesis_id === on.thesisId);
}

/** The tools a case may run for real: each only reads. */
const READS = new Set(["get_portfolio_context", "get_theses", "list_proposals", "get_market_context", "get_stock_data"]);

/** Chat with no analyst selected can't write to a stock (route.ts, UNSCOPED_BLOCKED_WRITES). */
const UNSCOPED_BLOCKED = ["place_trade", "close_position", "manage_position", "record_thesis", "update_thesis"];

/** The mode's tools as the model sees them: description and schema, no execute. */
function describedTools(c: HeroCase): ToolSet {
  if (c.mode === "thesis-writer") {
    // The writer's one tool. Its web search is left off: the note is written from the recorded data block.
    const submit = makeSubmitThesisTool({ ticker: String(c.promptArgs.ticker) } as never);
    return { submit_thesis: { description: submit.description, inputSchema: submit.inputSchema } } as ToolSet;
  }
  const all = createResearchTools({
    runId: "hero-case", userId: "hero", accountId: "hero", runMode: c.runMode, runEnvironment: "PAPER", ...c.toolCtx,
  } as never) as Record<string, { description?: string; inputSchema: unknown; toModelOutput?: unknown }>;
  // A fire's tools are its agent's: the post-trade write-up (promptArgs.autoTrade) has no trade tools, as the live run.
  const allowed = c.mode === "tactical" ? [...recordFor(c.promptArgs as { autoTrade?: { line: string } | null }).tools] : c.mode === "portfolio-manager" ? [...PORTFOLIO_MANAGER.tools] : (MODES[c.mode as keyof typeof MODES].toolAllowlist ?? Object.keys(all));
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
  if (!c.execute?.length) return null;
  if (isMarketOpen() && !inSession) {
    throw new Error(`the case runs ${c.execute.join(", ")} for real and the market is open; run it after the close, or pass --live-reads-in-session`);
  }
  for (const name of c.execute) if (!READS.has(name)) throw new Error(`${name} is not a read; a case can run only ${[...READS].join(", ")}`);
  if (!c.source?.runId) throw new Error("a case that runs reads needs source.runId");
  const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: c.source.runId }, select: { userId: true, accountId: true } });
  const all = createResearchTools({
    runId: "hero-case", userId: run.userId, accountId: run.accountId, runMode: c.runMode, runEnvironment: "PAPER", ...c.toolCtx,
  } as never) as unknown as Record<string, LiveRead>;
  return Object.fromEntries(c.execute.map((name) => [name, all[name]]));
}

/** The words a recorded trigger-run kickoff opens with, before what it asked: the facts of the fire. */
function factsOf(kickoff: ModelMessage | undefined): string | null {
  if (!kickoff || kickoff.role !== "user") return null;
  const text = typeof kickoff.content === "string" ? kickoff.content : kickoff.content.map((p) => ("text" in p ? p.text : "")).join("\n\n");
  const asks = [" Find out what is going on with the company", " Validate, decide"].map((a) => text.indexOf(a)).filter((i) => i > 0);
  return asks.length ? text.slice(0, Math.min(...asks)) : text;
}

/**
 * The request for a case, built by TODAY'S code: its instructions, and for a Writer,
 * trigger fire or a morning run its first message too (the stock, the trigger
 * and the fire, or the analyst, the account and the book's week, are blocks of
 * the first message); a trigger fire's from the recorded kickoff's facts.
 */
function requestFor(c: HeroCase): { system: string; first?: string } {
  if (c.context) return fromContext(c);
  if (c.mode === "thesis-writer") {
    // The stock's data as the run sent it; the rest of the first message is today's.
    const r = writerRequest(writerArgs(c), { dataBlock: dataBlockOf(c.messages[0]) });
    return { system: r.instructions, first: r.message };
  }
  if (c.mode === "research-run") {
    const r = morningRequest(c);
    return { system: r.instructions, first: r.message };
  }
  if (c.mode !== "tactical") return { system: systemFor(c) };
  const r = triggerRunRequest(tacticalArgs(c), { facts: factsOf(c.messages[0]) ?? "" });
  return { system: r.instructions, first: r.message };
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
  // The playbooks as an account that hasn't edited them reads them (the catalog's seed).
  return { ...p, analyst, setups: setupsForAnalyst(analyst.setupIds as string[]), playbooks: (id: string) => playbookTemplates(null, id) };
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
    situations: p.situations?.guidance ? p.situations : stock?.situations ?? null,
    autoTrade: p.autoTrade ?? null,
  };
}

function systemFor(c: HeroCase): string {
  if (c.context) return fromContext(c).system;
  switch (c.mode) {
    case "research-run":
      return morningRequest(c).instructions;
    default:
      return buildPrincipalSystemPrompt(c.promptArgs as never);
  }
}

/** A morning case's request, built by today's code from its inputs. */
function morningRequest(c: HeroCase) {
  // JSON turned the refusals' dates into strings; the builder wants dates.
  const runInput = c.promptArgs.runInput as { openRefusals?: Array<{ createdAt: string | Date }>; pendingApprovalCount?: number; analyst?: { pendingApprovalCount?: number } };
  for (const r of runInput.openRefusals ?? []) r.createdAt = new Date(r.createdAt);
  // Cases saved before step 10 carry the count on the run input's analyst copy.
  runInput.pendingApprovalCount ??= runInput.analyst?.pendingApprovalCount;
  return dailyRunRequest(c.promptArgs.config as never, runInput as never);
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

async function runCase(name: string, runs: number, writtenPath: string | null, inSession: boolean, liveSearch = false, inputsOnly = false): Promise<{ name: string; passes: number; runs: number; lookFor: string; noExpect?: boolean }> {
  const c = JSON.parse(readFileSync(`scripts/hero-cases/${name}.json`, "utf8")) as HeroCase;
  if (ONE_CALL.has(c.mode)) return runOneCall(name, c, runs, writtenPath, inputsOnly);
  const mode = modelOf(c);
  const { system, first } = requestFor(c);
  // A trigger fire's or a morning run's first message is today's too; the recorded one is replaced.
  if (first != null) c.messages = [{ role: "user", content: first }, ...c.messages.slice(1)];
  const tools = describedTools(c);
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
  // The Portfolio Manager's case runs on until its write-up: a reply with no call.
  const untilDone = c.mode === "portfolio-manager";
  const rows = recordedRows(c);

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
  const maxTurns = untilDone ? (c.maxTurns ?? 8) : c.scoreOn || live ? (c.maxTurns ?? 3) : 2;
  for (let i = 1; i <= runs; i++) {
    const messages: ModelMessage[] = [...c.messages];
    const calls: Call[] = [];
    const reads: Array<{ toolName: string; output: unknown }> = [];
    /** What each read the case runs for real handed the model: the grades count it as shown. */
    const readShown: unknown[] = [];
    let text = "";
    /** The last turn's text: the Portfolio Manager's write-up. */
    let lastText = "";
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
      const turnCalls: Call[] = result.toolCalls.filter((t) => !(t as { invalid?: boolean }).invalid).map((t) => ({ toolName: t.toolName, input: t.input }));
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
      lastText = result.text;
      // Done when the model answers without a call, or (with scoreOn) decides on the stock.
      const decided = turnCalls.length === 0 || (!untilDone && (c.scoreOn ? turnCalls.some((t) => DECIDING.has(t.toolName) && isOn(t, c.scoreOn!)) : !live));
      if (refusals.size === 0 && (decided || turn >= (c.scoreOn || live || untilDone ? maxTurns : 1))) break;
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
          // A get_theses on a stock the recording read is answered with the recorded row, as the model read it.
          const tickers = t.toolName === "get_theses" && rows.size ? ((t.input as { tickers?: string[] })?.tickers ?? []).map((x) => x.toUpperCase()) : [];
          if (tickers.length && !refusals.has(t.toolCallId)) {
            const found = tickers.flatMap((x) => (rows.has(x) ? [rows.get(x)!] : []));
            const raw = { ok: true, summary: `${found.length} of ${tickers.length} from the recorded read`, data: { theses: found } };
            const hook = (tools.get_theses as { toModelOutput?: (o: { toolCallId: string; input: unknown; output: unknown }) => unknown })?.toModelOutput;
            const forModel = hook ? await hook({ toolCallId: t.toolCallId, input: t.input, output: raw }) : { type: "json" as const, value: raw };
            return { type: "tool-result" as const, toolCallId: t.toolCallId, toolName: t.toolName, output: forModel as { type: "json"; value: never } };
          }
          if (read && !refusals.has(t.toolCallId)) {
            const output = await read.execute(t.input, { toolCallId: t.toolCallId, messages });
            reads.push({ toolName: t.toolName, output });
            const forModel = read.toModelOutput ? await read.toModelOutput({ toolCallId: t.toolCallId, input: t.input, output }) : { type: "json" as const, value: output };
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
    const own = RECORDS[c.mode] ? caseRules(RECORDS[c.mode]!.id, c, { calls, reply: lastText, shown }) : null;
    if (own) grades.rules = own.rules;
    console.log(`GRADES ${JSON.stringify(grades)}`);
    for (const b of grades.rules ?? []) console.log(`RULE ${b.rule}: ${b.problem}`);
    if (writtenPath) appendFileSync(writtenPath, JSON.stringify({ case: name, agent: RECORDS[c.mode]?.id ?? c.mode, hasExpect: c.expect != null, run: i, pass: verdict.pass, why: verdict.why, grades, narration: text.trim(), saved: writtenBy(calls), triggerFields, invalid, ...(readShown.length ? { readShown } : {}), calls: calls.map((c) => ({ tool: c.toolName, input: c.input })), ...(untilDone ? { reply: lastText } : {}) }) + "\n");
  }
  console.log(`\n${name}: ${passes}/${runs} pass — tokens in ${tokensIn.toLocaleString("en-US")} (${tokensCached.toLocaleString("en-US")} cached), out ${tokensOut.toLocaleString("en-US")}`);
  return { name, passes, runs, lookFor: c.lookFor };
}

/**
 * A one-call agent's case (the Market Reviewer, the portfolio digest): its
 * request put together from its context with today's record, sent the way its
 * run file sends it, the rest of the body as saved. The reviewer's web search
 * runs for real. Graded on the yardstick's grades and its own rules.
 */
async function runOneCall(name: string, c: HeroCase, runs: number, writtenPath: string | null, inputsOnly: boolean): Promise<{ name: string; passes: number; runs: number; lookFor: string; noExpect?: boolean }> {
  const { system, first, record } = fromContext(c);
  const shown = `${system}\n${first}`;
  if (writtenPath) {
    mkdirSync(`${dirname(writtenPath)}/inputs`, { recursive: true });
    writeFileSync(`${dirname(writtenPath)}/inputs/${name}.txt`, shown);
  }
  if (inputsOnly) return { name, passes: 0, runs: 0, lookFor: c.lookFor };
  const reviewer = c.mode === "market-reviewer";
  console.log(`\n# ${name} — ${record.model}, ${runs} run${runs === 1 ? "" : "s"}, instructions ${system.length.toLocaleString("en-US")} characters, first message ${first.length.toLocaleString("en-US")}`);
  console.log(c.what);
  console.log(`Look for: ${c.lookFor}`);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
  let passes = 0;
  let tokensIn = 0, tokensOut = 0;
  for (let i = 1; i <= runs; i++) {
    let reply = "";
    let notes: NonNullable<RuleRun["notes"]> = [];
    let error: string | null = null;
    let searches = 0;
    try {
      if (reviewer) {
        const body = { ...c.sent, model: record.model, input: [{ role: "system" as const, content: system }, { role: "user" as const, content: first }] };
        const resp = await client.responses.create(body as never, { timeout: 600_000 }) as unknown as OpenAI.Responses.Response;
        tokensIn += resp.usage?.input_tokens ?? 0;
        tokensOut += resp.usage?.output_tokens ?? 0;
        searches = resp.output.filter((o) => o.type === "web_search_call").length;
        if (resp.status === "incomplete") error = `cut off: ${resp.incomplete_details?.reason ?? "incomplete"}`;
        const parsed = (() => { try { return JSON.parse(resp.output_text ?? "") as { digest?: string; notes?: typeof notes }; } catch { return null; } })();
        if (!parsed?.digest) error ??= "the reply wasn't the digest and its notes";
        reply = parsed?.digest?.trim() ?? "";
        notes = parsed?.notes ?? [];
      } else {
        const body = { ...c.sent, model: record.model, messages: [{ role: "system" as const, content: system }, { role: "user" as const, content: first }] };
        const resp = await client.chat.completions.create(body as never) as unknown as OpenAI.Chat.Completions.ChatCompletion;
        tokensIn += resp.usage?.prompt_tokens ?? 0;
        tokensOut += resp.usage?.completion_tokens ?? 0;
        if (resp.choices[0]?.finish_reason === "length") error = "cut off at its limit";
        reply = resp.choices[0]?.message?.content?.trim() ?? "";
        if (!reply) error ??= "no text";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const written = [reply, ...notes.map((n) => n.text)].join("\n\n");
    const verdict = error ? { pass: false, why: error } : score(c.expect, [], written);
    if (verdict.pass) passes++;
    const grades = grade({ calls: [], narration: written }, shown, {});
    // A number in a sentence with its link is from a page it found; the replay can't read the page.
    const own = caseRules(record.id, c, { calls: [], reply, notes, shown });
    if (own?.invented) grades.invented = own.invented;
    grades.rules = error ? [] : own?.rules ?? [];
    console.log(`## run ${i} — ${error ? `failed: ${error}` : c.expect ? (verdict.pass ? "pass" : `fail: ${verdict.why}`) : "written"}${reviewer ? ` (${searches} searches, ${notes.length} notes: ${notes.map((n) => `${n.tickers.join("/")} ${n.impact}`).join(", ") || "none"})` : ""}`);
    console.log(reply.length > 900 ? reply.slice(0, 900) + "…" : reply);
    for (const b of grades.rules) console.log(`RULE ${b.rule}: ${b.problem}`);
    console.log(`GRADES ${JSON.stringify({ invented: grades.invented, prices: grades.prices })}`);
    if (writtenPath) appendFileSync(writtenPath, JSON.stringify({ case: name, agent: record.id, hasExpect: c.expect != null, run: i, pass: verdict.pass, why: verdict.why, error, grades, narration: reply, notes, searches }) + "\n");
  }
  console.log(`\n${name}: ${c.expect ? `${passes}/${runs} pass` : `${runs} written`} — tokens in ${tokensIn.toLocaleString("en-US")}, out ${tokensOut.toLocaleString("en-US")}`);
  return { name, passes, runs, lookFor: c.lookFor, noExpect: c.expect == null };
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
      console.log(`===== ${name} (${c.mode})\n${systemFor(c)}`);
    }
    return;
  }
  const results = [];
  const inSession = args.includes("--live-reads-in-session");
  // --inputs-only: save what each case is shown (beside --written) and call no model.
  for (const name of names) results.push(await runCase(name, runs, writtenPath, inSession, args.includes("--live-search"), args.includes("--inputs-only")));
  console.log("\n| Case | Pass | Looks for |\n|---|---|---|");
  for (const r of results) console.log(`| ${r.name} | ${r.noExpect ? `${r.runs} written` : `${r.passes}/${r.runs}`} | ${r.lookFor} |`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
