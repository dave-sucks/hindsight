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
 */
import { writeFileSync } from "fs";
import { prisma } from "@/lib/prisma";
import type { ModelMessage } from "ai";
import { buildRunInput } from "@/lib/agent/run-input";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { promptConfigFromAnalyst } from "@/lib/inngest/functions/morning-research";
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
  if (!runId || !tickerArg || !name) throw new Error("usage: hero-case-from-run.ts <runId> <TICKER> <case-name>");
  const ticker = tickerArg.toUpperCase();
  const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId }, select: { mode: true, parameters: true, agentConfigId: true, userId: true, startedAt: true } });
  const thread = await prisma.runMessage.findFirst({ where: { runId, role: "thread" }, select: { content: true } });
  if (!thread) throw new Error("no saved conversation on this run");
  const messages = JSON.parse(thread.content) as Msg[];
  const analyst = await prisma.agentConfig.findUniqueOrThrow({ where: { id: run.agentConfigId! } });
  const thesis = await prisma.thesis.findFirst({
    where: { ticker, researchRun: { agentConfigId: analyst.id }, status: { in: ["WATCHING", "HOLDING"] } },
    include: { researchRun: { select: { agentConfigId: true } }, updates: { orderBy: { timestamp: "desc" }, take: 40, select: ACTIVITY_SELECT } },
  });
  const thesisId = thesis?.id ?? ((run.parameters as { thesisId?: string })?.thesisId ?? null);

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
    promptArgs = { config: promptConfigFromAnalyst(analyst as never, watch), runInput: await buildRunInput(analyst.id, analyst.userId, creds) };
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
      analyst: { name: analyst.name, mandate: analyst.analystPrompt },
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
        id: analyst.id, name: analyst.name, analystPrompt: analyst.analystPrompt ?? null, directionBias: analyst.directionBias, holdDurations: analyst.holdDurations,
        sectors: analyst.sectors, industries: analyst.industries, themes: analyst.themes, marketCapMin: analyst.marketCapMin != null ? Number(analyst.marketCapMin) : null, marketCapMax: analyst.marketCapMax != null ? Number(analyst.marketCapMax) : null,
        watchlist: watch, exclusionList: analyst.exclusionList, minConfidence: analyst.minConfidence, maxPositionSize: Number(analyst.maxPositionSize), maxOpenPositions: analyst.maxOpenPositions,
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

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
