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
 */
import { writeFileSync } from "fs";
import { prisma } from "@/lib/prisma";
import type { ModelMessage } from "ai";
import { buildRunInput } from "@/lib/agent/run-input";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { BRIEF_FIELDS } from "@/lib/agent/analyst-brief";
import { stockContextFor, ACTIVITY_SELECT } from "@/lib/agent/stock-context-for";
import { loadLevelSources, resolveThesisLadder } from "@/lib/agent/triggers/load-levels";
import { classifyResearchAge } from "@/lib/agent/thesis-research/staleness";
import { getThesisBearCaseBullets, getThesisBullCaseBullets, getThesisSnapshotText } from "@/lib/agent/thesis-narrative";

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
  const analyst = await prisma.agentConfig.findUniqueOrThrow({ where: { id: run.agentConfigId! } });
  const thesis = await prisma.thesis.findFirst({
    where: { ticker, researchRun: { agentConfigId: analyst.id }, status: { in: ["WATCHING", "HOLDING"] } },
    include: { researchRun: { select: { agentConfigId: true } }, updates: { orderBy: { timestamp: "desc" }, take: 40, select: ACTIVITY_SELECT } },
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
  if (run.mode === "MORNING_PLAN") {
    mode = "research-run"; runMode = "MORNING_PLAN";
    const creds = (await resolveAlpacaCredentials(analyst.userId, env)) ?? undefined;
    promptArgs = { config: briefOf(analyst), runInput: await buildRunInput(analyst.id, analyst.userId, creds) };
    notes.push("promptArgs.runInput is the account as it is today, not on the run's day; the stock rows the run read are in messages.");
  } else if (run.mode === "INTRADAY_TACTICAL") {
    mode = "tactical"; runMode = "INTRADAY_TACTICAL";
    if (!thesis) throw new Error(`no live thesis on ${ticker} for ${analyst.name}`);
    const ladder = resolveThesisLadder(thesis as never, (await loadLevelSources([analyst.id])).get(analyst.id), `thesis=${thesis.id}`);
    const triggerId = (run.parameters as { triggerId?: string })?.triggerId;
    const trigger = ladder.find((t: { id: string }) => t.id === triggerId) ?? null;
    if (!trigger) notes.push(`the fired trigger ${triggerId} is no longer on the stock — put it back by hand in promptArgs.trigger and promptArgs.thesis.allTriggers`);
    const position = await prisma.position.findFirst({ where: { analystId: analyst.id, symbol: ticker, status: "OPEN" }, select: { quantity: true, avgCost: true, openedAt: true, peakPrice: true } });
    const firedPrice = (() => { const u = messages[0]; const text = Array.isArray(u?.content) ? u.content.map((p) => p.text ?? "").join(" ") : String(u?.content ?? ""); const m = text.match(/fired at \$([\d.]+)/); return m ? Number(m[1]) : null; })();
    promptArgs = {
      analyst: briefOf(analyst),
      thesis: {
        id: thesis.id, ticker, direction: thesis.direction, horizon: thesis.horizon, setupId: (thesis as { setupId?: string | null }).setupId ?? null,
        coreBelief: thesis.coreBelief, keyAssumptions: thesis.keyAssumptions, invalidationConds: thesis.invalidationConds,
        entryPrice: thesis.entryPrice != null ? Number(thesis.entryPrice) : null, targetPrice: thesis.targetPrice != null ? Number(thesis.targetPrice) : null, stopLoss: thesis.stopLoss != null ? Number(thesis.stopLoss) : null,
        snapshotText: getThesisSnapshotText(thesis as never) || null, bullCaseBullets: getThesisBullCaseBullets(thesis as never), bearCaseBullets: getThesisBearCaseBullets(thesis as never),
        researchAge: classifyResearchAge(thesis.researchUpdatedAt, thesis.horizon as never, thesis.status as never), allTriggers: ladder,
      },
      trigger,
      position: position ? { quantity: Number(position.quantity), avgCost: Number(position.avgCost), daysHeld: Math.floor((run.startedAt.getTime() - position.openedAt.getTime()) / 86400000), peakPrice: position.peakPrice != null ? Number(position.peakPrice) : null } : null,
      context: stockContextFor({ ticker, rows: thesis.updates.map((u) => ({ ...u, runMode: (u as { run?: { mode?: string } }).run?.mode ?? null })) as never, triggers: ladder, now: run.startedAt, currentPrice: firedPrice }).text,
      latestDigest: null,
      fired: { price: firedPrice, coFired: [] },
      capacity: null,
    };
    notes.push("promptArgs.thesis and context are the stock as it is today; check them against the run's day.");
  } else if (run.mode === "PRINCIPAL_CHAT") {
    mode = "principal"; runMode = "PRINCIPAL_CHAT";
    promptArgs = {
      scopedAnalyst: {
        id: analyst.id, ...briefOf(analyst), watchlist: watch,
        sectors: analyst.sectors, industries: analyst.industries, themes: analyst.themes, exclusionList: analyst.exclusionList,
        marketCapMin: analyst.marketCapMin != null ? Number(analyst.marketCapMin) : null, marketCapMax: analyst.marketCapMax != null ? Number(analyst.marketCapMax) : null,
      },
    };
  } else {
    throw new Error(`run mode ${run.mode} is not supported`);
  }

  const out = {
    what: `${ticker} ${run.startedAt.toISOString().slice(0, 10)}, ${run.mode} run ${runId} for ${analyst.name}. FILL IN: what the decision point is.`,
    lookFor: "FILL IN: the question the replay answers.",
    source: { runId, ticker, thesisId, cutBeforeMessage: cut, theRunDid: decided, notes },
    expect: { call: [{ tool: "update_thesis" }], never: [] },
    mode, runMode, promptArgs, toolCtx, messages: kept,
  };
  const file = `scripts/hero-cases/${name}.json`;
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${file}: ${kept.length} messages kept of ${messages.length}, ${JSON.stringify(kept).length.toLocaleString("en-US")} characters`);
  console.log(`the run then did: ${decided.join(" | ")}`);
  for (const n of notes) console.log(`note: ${n}`);
}

/** The analyst as the brief reads it (lib/agent/analyst-brief.ts), money columns as numbers. */
function briefOf(analyst: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(BRIEF_FIELDS.map((k) => [k, ["minPositionSize", "maxPositionSize", "maxPositionTotal"].includes(k) ? Number(analyst[k] ?? 0) : analyst[k] ?? null]));
}

/** A chat with no analyst selected: cut before the model's first turn. */
function unscopedChat(runId: string, run: { startedAt: Date; environment: string }, messages: Msg[], name: string) {
  const cut = messages.findIndex((m) => m.role === "assistant");
  if (cut <= 0) throw new Error("no assistant turn in this chat");
  const answered = (messages[cut].content as Part[]).filter((p) => p.type === "tool-call").map((p) => `${p.toolName} ${JSON.stringify(p.input).slice(0, 160)}`);
  const out = {
    what: `${run.startedAt.toISOString().slice(0, 10)}, a chat with no analyst selected, run ${runId}. FILL IN: the question, paraphrased (the repo is public).`,
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
