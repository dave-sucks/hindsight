/**
 * hero-case-from-run.ts — cut one decision out of a real run into a case
 * file for scripts/hero-case.ts (docs/plans/AGENT_ARCHITECTURE.md, step 2).
 *
 *   npx tsx --env-file=.env.local scripts/hero-case-from-run.ts <runId> <TICKER> <case-name>
 *
 * The recorded conversation is kept up to the model's first decision on the
 * stock: the first assistant turn that updates, trades or dispatches on it.
 * That turn is what the replay asks the model for again. The system prompt
 * is NOT stored: hero-case.ts rebuilds it with today's code from the
 * `promptArgs` written here, so a text change shows up in the replay.
 *
 * For a morning run the prompt inputs are the analyst as it is today and the
 * account as it is today (the stock rows the run read are in the recorded
 * conversation, which is what the decision rests on). For a trigger run the
 * stock's details are read as they are today; the fired trigger is looked up
 * by the id the run recorded, and a trigger removed since is reported so the
 * case can be finished by hand. `what`, `lookFor` and `expect` are left for
 * the person writing the case.
 *
 * A chat with no analyst selected has no stock decision to cut before: give
 * `-` for the ticker and the conversation is cut before the model's first
 * turn, so the case replays its answer to the opening question.
 *
 * A run that saved its request keeps its facts as it sent them (`context`,
 * lib/agent/yardstick/context.ts): a morning run's case reads the account of
 * its own morning, not today's. The Portfolio Manager (`-` for the ticker) is
 * cut before its first decision: a trade, a research request or its
 * write-up. The Market Reviewer and the portfolio digest (`-`) are one call
 * each: the case is their request, its facts and the rest of its body.
 */
import { writeFileSync } from "fs";
import { prisma } from "@/lib/prisma";
import type { ModelMessage } from "ai";
import { buildRunInput } from "@/lib/agent/run-input";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { BRIEF_FIELDS } from "@/lib/agent/analyst-brief";
import { createResearchTools } from "@/lib/agent/tools";
import { loadLevelSources, resolveThesisLadder } from "@/lib/agent/triggers/load-levels";
import { loadExistingThesis, loadWriterAnalyst } from "@/lib/agent/run-thesis-writer";
import { etDateOf } from "@/lib/market-data/intraday-window";
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { MARKET_REVIEWER } from "@/lib/agent/engine/agents/market-reviewer";
import { MORNING_RUN } from "@/lib/agent/engine/agents/morning-run";
import { PORTFOLIO_DIGEST } from "@/lib/agent/engine/agents/portfolio-digest";
import { PORTFOLIO_MANAGER } from "@/lib/agent/engine/agents/portfolio-manager";
import type { AgentRecord, SentPartManifest } from "@/lib/agent/engine/types";
import { contextFromHeadings, contextFromParts, loadedFrom, sentOf, type StoredContext } from "@/lib/agent/yardstick/context";

const DECIDING = new Set(["update_thesis", "place_trade", "close_position", "manage_position", "dispatch_thesis_research"]);

type Part = { type: string; toolName?: string; input?: Record<string, unknown>; text?: string };
type Msg = { role: string; content: Part[] | string };

function mentions(part: Part, ticker: string, thesisId: string | null): boolean {
  const a = part.input ?? {};
  const t = String(a.ticker ?? a.symbol ?? "").toUpperCase();
  return t === ticker || (thesisId != null && a.thesis_id === thesisId);
}

async function main() {
  const [runId, tickerArg, name] = process.argv.slice(2);
  if (!runId || !tickerArg || !name) throw new Error("usage: hero-case-from-run.ts <runId> <TICKER|-> <case-name>");
  const ticker = tickerArg.toUpperCase();
  const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId }, select: { mode: true, parameters: true, agentConfigId: true, userId: true, startedAt: true, environment: true } });
  const thread = await prisma.runMessage.findFirst({ where: { runId, role: "thread" }, select: { content: true } });
  if (!thread) throw new Error("no saved conversation on this run");
  const messages = JSON.parse(thread.content) as Msg[];
  if (run.mode === "PRINCIPAL_CHAT" && run.agentConfigId == null) return unscopedChat(runId, run, messages, name);
  if (run.mode === "THESIS_WRITER") return writerRun(runId, run, name);
  if (run.mode === "PORTFOLIO_MANAGER") return managerRun(runId, run, messages, name);
  if (run.mode === "MARKET_REVIEWER" || run.mode === "PORTFOLIO_DIGEST") return oneCallRun(runId, run, name);
  const analyst = await prisma.agentConfig.findUniqueOrThrow({ where: { id: run.agentConfigId! } });
  const thesis = await prisma.thesis.findFirst({
    where: { ticker, researchRun: { agentConfigId: analyst.id }, status: { in: ["WATCHING", "HOLDING"] } },
    include: { researchRun: { select: { agentConfigId: true } } },
  });
  // A stock retired since the run is found by the id its own read carried.
  const readId = (() => {
    for (const m of messages) for (const p of Array.isArray(m.content) ? m.content : []) {
      const out = (p as { type: string; toolName?: string; output?: { value?: { data?: { theses?: Array<{ id: string; ticker: string }> } } } });
      const row = out.type === "tool-result" && out.toolName === "get_theses" ? out.output?.value?.data?.theses?.find((t) => t.ticker === ticker) : undefined;
      if (row) return row.id;
    }
    return null;
  })();
  const thesisId = thesis?.id ?? readId ?? ((run.parameters as { thesisId?: string })?.thesisId ?? null);

  // Cut before the first deciding turn on this stock.
  let cut = messages.length;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    if (m.content.some((p) => p.type === "tool-call" && DECIDING.has(p.toolName ?? "") && mentions(p, ticker, thesisId))) { cut = i; break; }
  }
  if (cut === messages.length) throw new Error(`no deciding call on ${ticker} in this run`);
  const kept = messages.slice(0, cut) as ModelMessage[];
  const decided = (messages[cut].content as Part[]).filter((p) => p.type === "tool-call").map((p) => `${p.toolName} ${JSON.stringify(p.input).slice(0, 160)}`);

  const env = ((analyst as { tradingEnvironment?: string }).tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
  const watch = await getWatchlistSymbols(analyst.id);
  const toolCtx = {
    analystId: analyst.id, watchlist: watch,
    minPositionSize: Number(analyst.minPositionSize), maxPositionSize: Number(analyst.maxPositionSize),
    maxPositionTotal: Number((analyst as { maxPositionTotal?: unknown }).maxPositionTotal), maxOpenPositions: analyst.maxOpenPositions, minConfidence: analyst.minConfidence,
  };

  let mode: string; let runMode: string; let promptArgs: Record<string, unknown>; const notes: string[] = [];
  let context: StoredContext[] | undefined;
  if (run.mode === "MORNING_PLAN") {
    mode = "research-run"; runMode = "MORNING_PLAN";
    // The run's own facts, when it saved its request; else the account as it is today.
    const saved = await contextOfRun(runId, MORNING_RUN, run.startedAt, run.environment as "PAPER" | "LIVE");
    if (saved) {
      context = saved;
      promptArgs = { now: run.startedAt.toISOString(), environment: run.environment };
      notes.push("context is what the run was sent on its morning; the analyst's tools are as they are today.");
    } else {
      const creds = (await resolveAlpacaCredentials(analyst.userId, env)) ?? undefined;
      promptArgs = { config: briefOf(analyst), runInput: await buildRunInput(analyst.id, analyst.userId, creds) };
      notes.push("promptArgs.runInput is the account as it is today, not on the run's day; the stock rows the run read are in messages.");
    }
  } else if (run.mode === "INTRADAY_TACTICAL") {
    mode = "tactical"; runMode = "INTRADAY_TACTICAL";
    if (!thesis) throw new Error(`no live thesis on ${ticker} for ${analyst.name}`);
    const ladder = resolveThesisLadder(thesis as never, (await loadLevelSources([analyst.id])).get(analyst.id), `thesis=${thesis.id}`);
    const triggerId = (run.parameters as { triggerId?: string })?.triggerId;
    const trigger = ladder.find((t: { id: string }) => t.id === triggerId) ?? null;
    if (!trigger) notes.push(`the fired trigger ${triggerId} is no longer on the stock — put it back by hand in promptArgs.trigger and promptArgs.savedRow.triggers`);
    const position = await prisma.position.findFirst({ where: { analystId: analyst.id, symbol: ticker, status: "OPEN" }, select: { peakPrice: true } });
    const firedPrice = (() => { const u = messages[0]; const text = Array.isArray(u?.content) ? u.content.map((p) => p.text ?? "").join(" ") : String(u?.content ?? ""); const m = text.match(/fired at \$([\d.]+)/); return m ? Number(m[1]) : null; })();
    // The stock as the trigger run reads it (step 10): get_theses on the ticker, saved as the tool saves it.
    const tools = createResearchTools({ runId, userId: analyst.userId, accountId: analyst.accountId, analystId: analyst.id, runMode: "INTRADAY_TACTICAL", runEnvironment: env, minConfidence: analyst.minConfidence, maxOpenPositions: analyst.maxOpenPositions } as never) as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<{ ok: boolean; data?: { theses?: Array<Record<string, unknown>> } }> }>;
    const read = await tools.get_theses.execute({ tickers: [ticker] }, { toolCallId: "case", messages: [] });
    const savedRow = (read.data?.theses ?? []).find((r) => r.id === thesis.id) ?? null;
    if (!savedRow) notes.push("get_theses returned no row for the stock; fill promptArgs.savedRow by hand");
    promptArgs = {
      analyst: briefOf(analyst),
      savedRow,
      trigger,
      position: position ? { peakPrice: position.peakPrice != null ? Number(position.peakPrice) : null } : null,
      fired: { price: firedPrice },
      capacity: null,
    };
    notes.push("promptArgs.savedRow is the stock as it is today; check it against the run's day.");
  } else if (run.mode === "PRINCIPAL_CHAT") {
    mode = "principal"; runMode = "PRINCIPAL_CHAT";
    promptArgs = {
      scopedAnalyst: {
        id: analyst.id, ...briefOf(analyst), watchlist: watch,
        sectors: analyst.sectors, exclusionList: analyst.exclusionList,
        marketCapMin: analyst.marketCapMin != null ? Number(analyst.marketCapMin) : null, marketCapMax: analyst.marketCapMax != null ? Number(analyst.marketCapMax) : null,
      },
    };
  } else {
    throw new Error(`run mode ${run.mode} is not supported`);
  }

  const out = {
    what: `${ticker} ${etDateOf(run.startedAt)}, ${run.mode} run ${runId} for ${analyst.name}. FILL IN: what the decision point is.`,
    lookFor: "FILL IN: the question the replay answers.",
    source: { runId, ticker, thesisId, cutBeforeMessage: cut, theRunDid: decided, notes },
    expect: { call: [{ tool: "update_thesis" }], never: [] },
    mode, runMode, promptArgs, toolCtx, ...(context ? { context } : {}), messages: kept,
  };
  const file = `scripts/hero-cases/${name}.json`;
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${file}: ${kept.length} messages kept of ${messages.length}, ${JSON.stringify(kept).length.toLocaleString("en-US")} characters`);
  console.log(`the run then did: ${decided.join(" | ")}`);
  for (const n of notes) console.log(`note: ${n}`);
}

/** The run's saved request: its main call's record. */
async function savedRequest(runId: string): Promise<{ parts?: SentPartManifest[]; requests: unknown[] } | null> {
  const rows = await prisma.runMessage.findMany({ where: { runId, role: "request" }, orderBy: { createdAt: "asc" }, select: { content: true } });
  const records = rows.map((r) => JSON.parse(r.content) as { call: string; parts?: SentPartManifest[]; requests: unknown[] });
  return records.find((r) => r.call === "Main") ?? records[0] ?? null;
}

/**
 * The facts a run was sent, from its saved request, for the record that built
 * it; null when it saved none. Prints how the request today's record puts
 * together from them differs from the one the run sent: nothing, when only
 * the facts were the day's.
 */
async function contextOfRun(runId: string, record: AgentRecord, startedAt: Date, environment: "PAPER" | "LIVE"): Promise<StoredContext[] | null> {
  const req = await savedRequest(runId);
  if (!req?.requests?.length) return null;
  const sent = sentOf(req.requests[0]);
  const context = req.parts ? contextFromParts(record, sent, req.parts) : contextFromHeadings(record, sent);
  const { loaded, missing } = loadedFrom(record, context);
  const today = composeAgentRequest(record, { now: startedAt, environment }, loaded);
  for (const [what, a, b] of [["instructions", sent.instructions, today.instructions], ["first message", sent.message, today.message]] as const) {
    if (a === b) { console.log(`${what}: today's ${record.id} sends the run's, character for character`); continue; }
    let at = 0;
    while (at < a.length && a[at] === b[at]) at++;
    console.log(`${what}: today's ${record.id} sends ${b.length.toLocaleString("en-US")} characters against the run's ${a.length.toLocaleString("en-US")}, first different at ${at}: "${a.slice(at, at + 60).replace(/\n/g, "⏎")}" → "${b.slice(at, at + 60).replace(/\n/g, "⏎")}"`);
  }
  if (missing.length) console.log(`note: today's ${record.id} reads ${missing.join(", ")}, which the run wasn't sent`);
  return context;
}

/**
 * A Portfolio Manager run: cut before its first decision (a trade, a research
 * request, or its write-up, a reply with no call). The replay goes on until
 * its write-up.
 */
async function managerRun(runId: string, run: { startedAt: Date; environment: string }, messages: Msg[], name: string) {
  const context = await contextOfRun(runId, PORTFOLIO_MANAGER, run.startedAt, run.environment as "PAPER" | "LIVE");
  if (!context) throw new Error("no saved request on this run");
  const cut = messages.findIndex((m) => m.role === "assistant" && Array.isArray(m.content) && (m.content.some((p) => p.type === "tool-call" && DECIDING.has(p.toolName ?? "")) || !m.content.some((p) => p.type === "tool-call")));
  if (cut <= 0) throw new Error("no decision in this run");
  const did = messages.slice(cut).flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === "tool-call").map((p) => `${p.toolName} ${JSON.stringify(p.input).slice(0, 160)}`);
  const out = {
    what: `${etDateOf(run.startedAt)}, a Portfolio Manager run ${runId} on the ${run.environment} book. FILL IN: what the decision point is.`,
    lookFor: "FILL IN: the question the replay answers.",
    why: "FILL IN: the instruction that makes the expected answer right.",
    source: { runId, cutBeforeMessage: cut, theRunDid: did.length ? did : ["its write-up, no call"], notes: ["context is what the run was sent; a get_theses again is answered from the recorded read."] },
    expect: {},
    mode: "portfolio-manager", runMode: "PORTFOLIO_MANAGER",
    promptArgs: { now: run.startedAt.toISOString(), environment: run.environment },
    toolCtx: {}, context, messages: messages.slice(0, cut),
  };
  const file = `scripts/hero-cases/${name}.json`;
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${file}: ${cut} messages kept of ${messages.length}; the run then did: ${out.source.theRunDid.join(" | ")}`);
}

/** A Market Reviewer or portfolio digest run: one call, its facts and the rest of its body as saved. */
async function oneCallRun(runId: string, run: { mode: string; startedAt: Date; environment: string }, name: string) {
  const reviewer = run.mode === "MARKET_REVIEWER";
  const record = reviewer ? MARKET_REVIEWER : PORTFOLIO_DIGEST;
  const req = await savedRequest(runId);
  const context = await contextOfRun(runId, record, run.startedAt, run.environment as "PAPER" | "LIVE");
  if (!req || !context) throw new Error("no saved request on this run");
  // The body as sent, less what the replay sends itself: the model and the messages.
  const { model: _model, messages: _messages, input: _input, ...sent } = req.requests[0] as Record<string, unknown>;
  const out = {
    what: `${etDateOf(run.startedAt)}, the ${reviewer ? "Market Reviewer" : "portfolio digest"} run ${runId} on the ${run.environment} book.`,
    lookFor: reviewer ? "The digest and its notes keep the rules of its instructions: its six sections, its numbers sourced, nothing on a waiting proposal." : "The digest keeps the rules of its instructions: every waiting proposal with a view, nothing invented, no advice on the cash.",
    source: { runId, notes: [reviewer ? "the replay's web search reads today's web, not the run's day." : "the replay is sent what the run was sent."] },
    mode: reviewer ? "market-reviewer" : "portfolio-digest", runMode: run.mode,
    promptArgs: { now: run.startedAt.toISOString(), environment: run.environment },
    toolCtx: {}, context, sent, messages: [],
  };
  const file = `scripts/hero-cases/${name}.json`;
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${file}: ${context.filter((c) => c.text != null).length} facts, ${JSON.stringify(context).length.toLocaleString("en-US")} characters`);
}

/** The analyst as the brief reads it (lib/agent/analyst-brief.ts), money columns as numbers. */
function briefOf(analyst: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(BRIEF_FIELDS.map((k) => [k, ["minPositionSize", "maxPositionSize", "maxPositionTotal"].includes(k) ? Number(analyst[k] ?? 0) : analyst[k] ?? null]));
}

/**
 * A Writer run: its one decision is the research call. The first message is
 * the one the run sent, word for word (its Research request); the inputs the
 * instructions are built from are the run's own (reason, notes, idea, mode)
 * and, for the analyst and a refresh's thesis, as they are today.
 */
async function writerRun(runId: string, run: { startedAt: Date; parameters: unknown; agentConfigId: string | null }, name: string) {
  const p = (run.parameters ?? {}) as Record<string, unknown>;
  const rows = await prisma.runMessage.findMany({ where: { runId, role: "request" }, select: { content: true } });
  const record = rows.map((r) => JSON.parse(r.content) as { call: string; requests: Array<{ messages?: Array<{ role: string; content: unknown }> }> }).find((r) => r.call === "Research");
  const first = record?.requests[0]?.messages?.find((m) => m.role === "user");
  if (!first) throw new Error("no Research request saved on this run");
  const text = typeof first.content === "string" ? first.content : (first.content as Array<{ text?: string }>).map((x) => x.text ?? "").join("\n\n");
  const analyst = await loadWriterAnalyst(run.agentConfigId!);
  if (!analyst) throw new Error("the run's analyst is gone");
  const existingThesis = p.mode === "refresh" && p.existingThesisId ? await loadExistingThesis(String(p.existingThesisId)) : null;
  const promptArgs = {
    ticker: p.ticker, mode: p.mode, analyst: briefOf(analyst as never), existingThesis,
    reason: p.reason ?? "", researchNotes: p.researchNotes ?? null, ideaSource: p.ideaSource ?? null,
    promotionContext: p.promotionContext ?? null, runDate: etDateOf(run.startedAt),
  };
  const out = {
    what: `${p.ticker} ${etDateOf(run.startedAt)}, a Writer ${p.mode} run ${runId}${existingThesis ? ` on a ${existingThesis.status} thesis` : ""}. FILL IN: what the decision point is.`,
    lookFor: "FILL IN: the question the replay answers.",
    source: { runId, ticker: p.ticker, notes: ["promptArgs.existingThesis and the analyst are as they are today; the first message is the run's own."] },
    expect: { call: [{ tool: "submit_thesis" }], never: [] },
    mode: "thesis-writer", runMode: "THESIS_WRITER", promptArgs, toolCtx: {},
    messages: [{ role: "user", content: text }],
  };
  const file = `scripts/hero-cases/${name}.json`;
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${file}: the run's first message, ${text.length.toLocaleString("en-US")} characters`);
}

/** A chat with no analyst selected: cut before the model's first turn. */
function unscopedChat(runId: string, run: { startedAt: Date; environment: string }, messages: Msg[], name: string) {
  const cut = messages.findIndex((m) => m.role === "assistant");
  if (cut <= 0) throw new Error("no assistant turn in this chat");
  const answered = (messages[cut].content as Part[]).filter((p) => p.type === "tool-call").map((p) => `${p.toolName} ${JSON.stringify(p.input).slice(0, 160)}`);
  const out = {
    what: `${etDateOf(run.startedAt)}, a chat with no analyst selected, run ${runId}. FILL IN: the question, paraphrased (the repo is public).`,
    lookFor: "FILL IN: the question the replay answers.",
    source: { runId, cutBeforeMessage: cut, theRunDid: answered, notes: [`the chat ran in the ${run.environment} book; set toolCtx.runEnvironment to the book the question is about`] },
    expect: { call: [], never: [] },
    mode: "principal", runMode: "PRINCIPAL_CHAT", promptArgs: { scopedAnalyst: null }, toolCtx: { runEnvironment: run.environment },
    // The chat saves the owner's turns as the screen sent them (`parts`); the replay sends the model's form.
    messages: messages.slice(0, cut).map((m) => {
      const parts = (m as { parts?: Part[] }).parts;
      return parts ? { role: m.role, content: parts.filter((p) => p.type === "text").map((p) => ({ type: "text", text: p.text ?? "" })) } : m;
    }),
  };
  const file = `scripts/hero-cases/${name}.json`;
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${file}: ${cut} messages kept of ${messages.length}; the chat then did: ${answered.join(" | ")}`);
  console.log("note: the owner's words are copied as they are — paraphrase them before the file is committed.");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
