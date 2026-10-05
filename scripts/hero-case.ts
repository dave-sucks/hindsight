/**
 * hero-case.ts — real decisions, replayed against the real model and scored
 * by code (docs/plans/AGENT_ARCHITECTURE.md, step 2).
 *
 *   npx tsx --env-file=.env.local scripts/hero-case.ts <case> [--runs 6]
 *   npx tsx --env-file=.env.local scripts/hero-case.ts --all [--runs 6]
 *   … [--written out.jsonl]  also append what each run wrote for the
 *                            owner (narration + shown text fields), for
 *                            scripts/voice-count.ts. Scoring is unchanged.
 *   cases: scripts/hero-cases/*.json  (cut from real runs by hero-case-from-run.ts)
 *
 * Each case is a recorded conversation up to one decision. The system prompt
 * is built by TODAY'S code from the case's inputs, so a prompt, setup or
 * tool change shows up here. The model gets ONE turn, several times, because
 * one run of a model proves nothing. The tools are described to it and never
 * run: nothing is executed, nothing touches the database or the account.
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
import { appendFileSync, readFileSync, readdirSync } from "fs";
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { MODES, buildPrincipalSystemPrompt } from "@/lib/agent/modes";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { buildDailyRunSystemPromptV2 } from "@/lib/agent/system-prompt";
import { createResearchTools } from "@/lib/agent/tools";
import { buildWriterResearchPrompt, makeSubmitThesisTool } from "@/lib/agent/run-thesis-writer";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";

type Cond = "present" | "absent" | string | number | boolean | { lt?: number; gt?: number; regex?: string };
interface Rule { tool: string; where?: Record<string, Cond> }
interface Expect { call?: Rule[]; never?: Rule[]; text?: { regex: string }; neverText?: { regex: string } }
interface HeroCase {
  what: string;
  lookFor: string;
  expect?: Expect;
  /**
   * The stock the case is about. A morning run answers several stocks and
   * may take another first; with this set, the turn is repeated (up to
   * `maxTurns`, default 3) with every call answered by a stub reply until
   * the model updates, trades or dispatches on this stock. Nothing is run.
   */
  scoreOn?: { ticker?: string; thesisId?: string };
  maxTurns?: number;
  mode: "principal" | "tactical" | "thesis-writer" | "research-run";
  runMode: string;
  promptArgs: Record<string, unknown>;
  toolCtx: Record<string, unknown>;
  messages: ModelMessage[];
}
interface Call { toolName: string; input: unknown }

const DECIDING = new Set(["update_thesis", "place_trade", "close_position", "manage_position", "dispatch_thesis_research"]);

function isOn(call: Call, on: NonNullable<HeroCase["scoreOn"]>): boolean {
  const a = (call.input ?? {}) as Record<string, unknown>;
  const t = String(a.ticker ?? a.symbol ?? "").toUpperCase();
  return (on.ticker != null && t === on.ticker.toUpperCase()) || (on.thesisId != null && a.thesis_id === on.thesisId);
}

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
  const allowed = MODES[c.mode].toolAllowlist ?? Object.keys(all);
  const scoped = c.mode !== "principal" || c.toolCtx.analystId != null;
  return Object.fromEntries(
    allowed
      .filter((name) => all[name] && (scoped || !UNSCOPED_BLOCKED.includes(name)))
      .map((name) => [name, { description: all[name].description, inputSchema: all[name].inputSchema, toModelOutput: all[name].toModelOutput }]),
  ) as ToolSet;
}

function systemFor(c: HeroCase): string {
  switch (c.mode) {
    case "tactical":
      return buildTacticalSystemPrompt(c.promptArgs as never);
    case "thesis-writer":
      return buildWriterResearchPrompt({ ...c.promptArgs, setups: setupsForAnalyst(c.promptArgs.setupIds as string[]) } as never);
    case "research-run": {
      // JSON turned the refusals' dates into strings; the builder wants dates.
      const runInput = c.promptArgs.runInput as { openRefusals?: Array<{ createdAt: string | Date }> };
      for (const r of runInput.openRefusals ?? []) r.createdAt = new Date(r.createdAt);
      return buildDailyRunSystemPromptV2(c.promptArgs.config as never, runInput as never);
    }
    default:
      return buildPrincipalSystemPrompt(c.promptArgs as never);
  }
}

/** Every value at a dot path; `*` steps into each element of an array; `$sum` adds the `score` of each child; `$count` is the number of children. */
function valuesAt(obj: unknown, path: string): unknown[] {
  let current: unknown[] = [obj];
  for (const key of path.split(".")) {
    const next: unknown[] = [];
    for (const v of current) {
      if (v == null || typeof v !== "object") continue;
      if (key === "*") { if (Array.isArray(v)) next.push(...v); continue; }
      if (key === "$sum") {
        const dims = Object.values(v as Record<string, unknown>);
        next.push(dims.reduce<number>((s, d) => s + (typeof d === "object" && d != null && typeof (d as { score?: unknown }).score === "number" ? (d as { score: number }).score : 0), 0));
        continue;
      }
      if (key === "$count") {
        next.push(Array.isArray(v) ? v.length : Object.keys(v as Record<string, unknown>).length);
        continue;
      }
      if (Array.isArray(v)) continue;
      const got = (v as Record<string, unknown>)[key];
      if (got !== undefined) next.push(got);
    }
    current = next;
  }
  return current.filter((v) => v !== undefined && v !== null);
}

function holds(input: unknown, path: string, cond: Cond): boolean {
  const found = valuesAt(input, path);
  if (cond === "present") return found.length > 0;
  if (cond === "absent") return found.length === 0;
  if (typeof cond === "object") {
    return found.some((v) =>
      (cond.lt === undefined || (typeof v === "number" && v < cond.lt)) &&
      (cond.gt === undefined || (typeof v === "number" && v > cond.gt)) &&
      (cond.regex === undefined || new RegExp(cond.regex, "i").test(String(v))),
    );
  }
  return found.some((v) => v === cond);
}

function matches(call: Call, rule: Rule): boolean {
  if (call.toolName !== rule.tool) return false;
  return Object.entries(rule.where ?? {}).every(([path, cond]) => holds(call.input, path, cond));
}

function score(ex: Expect | undefined, calls: Call[], text: string): { pass: boolean; why: string } {
  if (!ex) return { pass: true, why: "no expectation" };
  const why: string[] = [];
  if (ex.call?.length && !ex.call.some((r) => calls.some((c) => matches(c, r)))) why.push(`no ${ex.call.map((r) => r.tool).join(" / ")} as expected`);
  for (const r of ex.never ?? []) if (calls.some((c) => matches(c, r))) why.push(`made the ${r.tool} it must not`);
  if (ex.text && !new RegExp(ex.text.regex, "i").test(text)) why.push(`text lacks /${ex.text.regex}/`);
  if (ex.neverText && new RegExp(ex.neverText.regex, "i").test(text)) why.push(`text has /${ex.neverText.regex}/`);
  return { pass: why.length === 0, why: why.join("; ") };
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

async function runCase(name: string, runs: number, writtenPath: string | null): Promise<{ name: string; passes: number; runs: number; lookFor: string }> {
  const c = JSON.parse(readFileSync(`scripts/hero-cases/${name}.json`, "utf8")) as HeroCase;
  const mode = MODES[c.mode];
  const system = systemFor(c);
  const tools = describedTools(c);
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
  const maxTurns = c.scoreOn ? (c.maxTurns ?? 3) : 1;
  for (let i = 1; i <= runs; i++) {
    const messages: ModelMessage[] = [...c.messages];
    const calls: Call[] = [];
    let text = "";
    let turns = 0;
    /** Calls the SDK could not match to the schema (a missing field, an enum written as a word). */
    const invalid: Array<{ tool: string; error: string }> = [];
    for (let turn = 1; turn <= maxTurns; turn++) {
      turns = turn;
      const result = await generateText({ model, system, messages, tools, stopWhen: stepCountIs(1), providerOptions });
      tokensIn += result.usage.inputTokens ?? 0;
      tokensCached += result.usage.inputTokenDetails?.cacheReadTokens ?? result.usage.cachedInputTokens ?? 0;
      tokensOut += result.usage.outputTokens ?? 0;
      const turnCalls: Call[] = result.toolCalls.map((t) => ({ toolName: t.toolName, input: t.input }));
      for (const t of result.toolCalls as Array<{ toolName: string; invalid?: boolean; error?: unknown }>) {
        if (t.invalid) invalid.push({ tool: t.toolName, error: String((t.error as Error)?.message ?? t.error).slice(0, 300) });
      }
      calls.push(...turnCalls);
      text += (text ? "\n" : "") + result.text;
      if (!c.scoreOn || turnCalls.length === 0 || turnCalls.some((t) => DECIDING.has(t.toolName) && isOn(t, c.scoreOn!))) break;
      // Not there yet: answer every call with a stub and let the model go on.
      // Nothing is run. Ending the run is refused the way complete_run
      // refuses it when a stock on the list has not been answered.
      const left = c.scoreOn.ticker ?? c.scoreOn.thesisId ?? "the stock";
      messages.push(...(result.response.messages as ModelMessage[]));
      messages.push({
        role: "tool",
        content: result.toolCalls.map((t) => ({
          type: "tool-result" as const,
          toolCallId: t.toolCallId,
          toolName: t.toolName,
          output: {
            type: "json" as const,
            value:
              t.toolName === "complete_run"
                ? { ok: false, error: `complete_run refused: $${left} is on today's list and has not been answered. Answer it, then call complete_run.` }
                : { ok: true, summary: "Replay: this call was recorded, not executed." },
          },
        })),
      });
    }
    const verdict = score(c.expect, calls, text);
    if (verdict.pass) passes++;
    console.log(`## run ${i} — ${verdict.pass ? "pass" : `fail: ${verdict.why}`}${turns > 1 ? ` (${turns} turns)` : ""}`);
    if (text.trim()) console.log(text.trim().length > 600 ? text.trim().slice(0, 600) + "…" : text.trim());
    for (const call of calls) console.log(`CALL ${brief(call)}`);
    for (const bad of invalid) console.log(`INVALID ${bad.tool}: ${bad.error}`);
    if (writtenPath) appendFileSync(writtenPath, JSON.stringify({ case: name, run: i, narration: text.trim(), saved: writtenBy(calls), invalid }) + "\n");
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
  if (names.length === 0) throw new Error("usage: hero-case.ts <case>... | --all  [--runs N]");
  const results = [];
  for (const name of names) results.push(await runCase(name, runs, writtenPath));
  console.log("\n| Case | Pass | Looks for |\n|---|---|---|");
  for (const r of results) console.log(`| ${r.name} | ${r.passes}/${r.runs} | ${r.lookFor} |`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
