/**
 * backfill-case-facts.ts — put the facts of step 8 on every recorded
 * get_theses full row in scripts/hero-cases/*.json, as of each row's own
 * read time, so the runner's replay through today's `rowForModel` can build
 * the row the live read builds, with no database at replay time.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-case-facts.ts [--dry-run] [case ...]
 *
 * Read-only against the database; writes only the case files. For each full
 * row (`data.theses`) of each recorded get_theses result, dated by its
 * `resolved.resolvedAt` (the recording's own read time; the run's start when
 * a row has none), it adds what the live row carries since step 8:
 *
 *   position          the position open at that time: opened on or before it,
 *                     closed after it or still open. Its quantity, cost and
 *                     peak are the row's today; an add or trim since shows.
 *   proposals         the orders awaiting approval at that time: created on
 *                     or before it, resolved after it. The resolution time is
 *                     read from the fill, the expiry or the row's last update.
 *                     An approximation; the live read is exact.
 *   price             the recorded price; the day's change read off the
 *                     snapshot's closes the way the quote reads it; the time.
 *   chart             the newest TickerIndicators row computed by then and
 *                     within five days of it (the loader's rule). The table
 *                     starts 2026-09-10; a row read before that has none.
 *   inheritedTriggers today's analyst and account rules, resolved against the
 *                     thesis's stored triggers today, each with its level.
 *                     The rules keep no history.
 *   situations        computeNeedsAction and situationsFor over the inputs as
 *                     of then: the activity's types and timestamps, the
 *                     declined sales, the fires, the price. The research's
 *                     age is the recording's own (`researchAge`), since the
 *                     classifier reads the wall clock. The recorded lead
 *                     (`needsAction`) is kept; the script warns when the
 *                     recomputed lead differs.
 *
 * `context` and `principalDirective` stay exactly as recorded: a back-fill of
 * context would put the principal's words into a public file. No guidance
 * text is stored; the read attaches it from the table at read time. The
 * case's `source.notes` says what was filled and when.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { prisma } from "@/lib/prisma";
import { loadLevelSources, resolveThesisLadder } from "@/lib/agent/triggers/load-levels";
import { triggerForAgent } from "@/lib/agent/triggers/format";
import { chartFacts, parseIndicatorSnapshot, type IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { MAX_SNAPSHOT_AGE_DAYS } from "@/lib/market-data/load-indicators";
import { computeNeedsAction, type NeedsActionInput } from "@/lib/agent/needs-action";
import { situationsFor, type SituationSources } from "@/lib/agent/situations";
import { ACTIVITY_SELECT, stockContextFor } from "@/lib/agent/stock-context-for";
import type { ActivityRow } from "@/lib/agent/stock-context";
import { declinedSaleWhere, declinedSaleWork, foldDeclines, isSystemicRejection, type DeclineRow } from "@/lib/agent/declined-sale";
import { computeLadderHealth } from "@/lib/agent/ladder-health";
import { ROW_FACTS } from "@/lib/agent/tools/get-theses";
import type { Trigger } from "@/lib/agent/triggers/types";

const DAY = 86_400_000;
const TODAY = new Date().toISOString().slice(0, 10);

type Row = Record<string, unknown>;
interface Case {
  source?: { runId?: string; notes?: string[] } & Row;
  toolCtx: { analystId?: string; runEnvironment?: string } & Row;
  messages: Array<{ role: string; content: unknown }>;
}

/** The recorded get_theses results in a case, each with its full rows. */
function recordedReads(c: Case): Array<Row[]> {
  const out: Array<Row[]> = [];
  for (const m of c.messages) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const p of m.content as Array<{ type: string; toolName?: string; output?: { value?: { data?: { theses?: Row[] } } } & { data?: { theses?: Row[] } } }>) {
      if (p.type !== "tool-result" || p.toolName !== "get_theses") continue;
      const data = p.output?.value?.data ?? p.output?.data;
      if (Array.isArray(data?.theses)) out.push(data.theses);
    }
  }
  return out;
}

const date = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v === "string" && v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const etClock = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false });

/** The quote's own day change at `at`: before 09:30 ET the price is the last close, so the change is the session before's. */
function dayChangePct(snap: IndicatorSnapshot | null, price: number | null, at: Date): number | null {
  if (!snap || price == null || snap.closes.length < 2) return null;
  const closes = snap.closes;
  const preOpen = etClock(at) < "09:30:00";
  const pc = preOpen ? closes[closes.length - 2] : closes[closes.length - 1];
  return pc > 0 ? ((price - pc) / pc) * 100 : null;
}

/** When a proposal left the queue: the fill, the expiry, or the row's last change. Null while it is still waiting. */
function resolvedAt(o: { status: string; filledAt: Date | null; expiresAt: Date | null; updatedAt: Date }): Date | null {
  if (o.status === "AWAITING_APPROVAL") return null;
  if (o.status === "FILLED") return o.filledAt ?? o.updatedAt;
  if (o.status === "EXPIRED") return o.expiresAt ?? o.updatedAt;
  return o.updatedAt;
}

async function backfill(name: string, dryRun: boolean): Promise<void> {
  const file = `scripts/hero-cases/${name}.json`;
  const before = statSync(file).size;
  const original = readFileSync(file, "utf8");
  const c = JSON.parse(original) as Case;
  const reads = recordedReads(c);
  if (reads.length === 0) { console.log(`${name}: no recorded get_theses read; untouched`); return; }
  const analystId = c.toolCtx?.analystId;
  if (!analystId) throw new Error(`${name}: toolCtx.analystId missing; the facts are the analyst's`);
  const run = c.source?.runId ? await prisma.researchRun.findUnique({ where: { id: c.source.runId }, select: { startedAt: true, environment: true, userId: true } }) : null;
  const analyst = await prisma.agentConfig.findUniqueOrThrow({ where: { id: analystId }, select: { userId: true, tradingEnvironment: true } });
  const env = (run?.environment ?? (analyst as { tradingEnvironment?: string }).tradingEnvironment ?? "PAPER") as "PAPER" | "LIVE";
  const userId = run?.userId ?? analyst.userId;

  const rows = reads.flat();
  const ids = Array.from(new Set(rows.map((r) => String(r.id))));
  const tickers = Array.from(new Set(rows.map((r) => String(r.ticker).toUpperCase())));

  // One query per table; the as-of filtering is done here, per row.
  const [positions, orders, indicators, theses, updates, levelSources] = await Promise.all([
    prisma.position.findMany({
      where: { analystId, symbol: { in: tickers }, environment: env, status: { in: ["OPEN", "CLOSED"] } },
      select: { id: true, symbol: true, status: true, quantity: true, avgCost: true, peakPrice: true, openedAt: true, closedAt: true },
    }),
    prisma.order.findMany({
      where: { userId, thesisId: { in: ids }, expiresAt: { not: null } },
      select: { id: true, thesisId: true, positionId: true, side: true, intent: true, quantity: true, status: true, closeReason: true, rejectionMessage: true, createdAt: true, expiresAt: true, filledAt: true, updatedAt: true },
    }),
    prisma.tickerIndicators.findMany({ where: { ticker: { in: tickers } }, orderBy: { computedAt: "desc" }, select: { ticker: true, asOf: true, computedAt: true, snapshot: true } }),
    prisma.thesis.findMany({ where: { id: { in: ids } }, select: { id: true, triggers: true, triggerState: true } }),
    prisma.thesisUpdate.findMany({ where: { thesisId: { in: ids } }, orderBy: { timestamp: "desc" }, select: ACTIVITY_SELECT }),
    loadLevelSources([analystId]).then((m) => m.get(analystId)),
  ]);
  const thesisById = new Map(theses.map((t) => [t.id, t]));

  let leadDiffers = 0;
  let filled = 0;
  const chartless: string[] = [];
  for (const row of rows) {
    const id = String(row.id);
    const ticker = String(row.ticker).toUpperCase();
    const status = String(row.status);
    const direction = (row.direction as string | null) ?? null;
    const resolved = (row.resolved ?? null) as Row | null;
    const at = date(resolved?.resolvedAt) ?? run?.startedAt ?? null;
    if (!at) throw new Error(`${name}: ${ticker} has no resolvedAt and the case has no run to date it from`);
    const price = num(resolved?.currentPrice);
    const held = status === "HOLDING";

    // The position open at `at`, for a held stock.
    const pos = held
      ? positions
          .filter((p) => p.symbol === ticker && p.openedAt <= at && (p.closedAt == null || p.closedAt > at))
          .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())[0] ?? null
      : null;
    const position = pos
      ? { quantity: Number(pos.quantity), avgCost: Number(pos.avgCost), openedAt: pos.openedAt, peakPrice: pos.peakPrice != null ? Number(pos.peakPrice) : null }
      : null;

    // The proposals in the queue at `at`.
    const own = orders.filter((o) => o.thesisId === id);
    const awaiting = own
      .filter((o) => o.createdAt <= at && (resolvedAt(o) == null || resolvedAt(o)! > at))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((o) => ({ id: o.id, side: o.side === "SELL" ? "SELL" : "BUY", intent: o.intent ?? null, quantity: Number(o.quantity), createdAt: o.createdAt, expiresAt: o.expiresAt }));

    // The chart as the loader would have read it at `at`.
    const snapRow = indicators.find((r) => r.ticker === ticker && r.computedAt <= at && (at.getTime() - Date.parse(`${r.asOf}T00:00:00Z`)) / DAY <= MAX_SNAPSHOT_AGE_DAYS) ?? null;
    const snap = snapRow ? parseIndicatorSnapshot(snapRow.snapshot) : null;
    if (!snap) chartless.push(ticker);
    const chart = snap ? chartFacts(snap, price) : null;
    const dp = dayChangePct(snap, price, at);
    const priceFact = price != null ? { current: price, dayChangePct: dp != null ? Math.round(dp * 100) / 100 : null, asOf: at } : null;

    // Today's rules, resolved against the thesis's stored triggers today.
    const stored = thesisById.get(id);
    const ladder = resolveThesisLadder(
      { id, triggers: stored?.triggers ?? [], triggerState: stored?.triggerState ?? {}, status, direction } as never,
      levelSources,
      `thesis=${id}`,
    ) as Array<Trigger & { level?: string }>;
    const inheritedTriggers = ladder.filter((x) => (x.level ?? "THESIS") !== "THESIS").map((x) => ({ ...triggerForAgent(x, held), level: x.level }));

    // The situations as of `at`: the flag math over the inputs then.
    const activity = updates.filter((u) => u.thesisId === id && u.timestamp <= at);
    const recent = activity.slice(0, 40);
    const notes = activity.filter((u) => u.type === "NOTE");
    const seen = new Set(recent.map((u) => u.id));
    const rowsThen: ActivityRow[] = [...recent, ...notes.filter((n) => !seen.has(n.id))].map((u) => ({ ...u, runMode: (u as { run?: { mode?: string | null } }).run?.mode ?? null })) as ActivityRow[];
    const pendingBuy = awaiting.some((o) => o.side === "BUY" && o.intent === "OPEN");
    // A row recorded before the read selected `lastReviewedAt` has no such
    // field; the newest review or update on record by then stands in. A
    // recorded null is a stock never reviewed and stays null.
    const lastReviewedAt = row.lastReviewedAt === undefined
      ? activity.find((u) => u.type === "REVIEWED" || u.type === "UPDATED")?.timestamp ?? null
      : date(row.lastReviewedAt);
    const floorRisk = (resolved?.floorRisk ?? null) as Row | null;
    const input: NeedsActionInput = {
      thesis: {
        id, direction, status, triggers: ladder, createdAt: date(row.createdAt) ?? at,
        lastReviewedAt, researchUpdatedAt: date(row.researchUpdatedAt), horizon: (row.horizon as string | null) ?? null,
        positionOpenedAt: position?.openedAt ?? null, avgCost: position?.avgCost ?? null, peakPrice: position?.peakPrice ?? null,
        atr14: snap?.atr14 ?? null, quantity: position && position.quantity > 0 ? position.quantity : null,
        structure: snap ? { low20: snap.low20, sma20: snap.sma[20], sma50: snap.sma[50], sma200: snap.sma[200] } : null,
        targetPrice: num(row.targetPrice),
        paperTenureDays: num(row.paperTenureDays), paperRealizedPnl: num(row.paperRealizedPnl), paperReviewCount: num(row.paperReviewCount), promotedAt: date(row.promotedAt),
      },
      activity: rowsThen,
      recentUpdates: rowsThen,
      latestQuote: price != null ? { price, changePct: dp ?? 0 } : null,
      now: at,
      hasPendingEntryProposal: pendingBuy,
      equity: num(floorRisk?.equity),
    };
    // A declined protective sale inside the window before `at`, judged as the loader judges it.
    if (pos) {
      const declined = declinedSaleWhere(at);
      const declineRows: DeclineRow[] = own
        .filter((o) => o.positionId === pos.id && o.side === "SELL" && o.intent === declined.intent && o.closeReason === declined.closeReason)
        .filter((o) => !isSystemicRejection(o.rejectionMessage) && o.createdAt >= declined.createdAt.gte)
        .filter((o) => { const r = resolvedAt(o); return r != null && r <= at && (declined.status.in as string[]).includes(o.status); })
        .map((o) => ({ createdAt: o.createdAt, rejectionMessage: o.rejectionMessage }));
      const folded = foldDeclines(declineRows);
      if (folded) {
        const floor = computeLadderHealth({ direction, avgCost: position?.avgCost ?? null, currentPrice: price, peakPrice: position?.peakPrice ?? null, triggers: ladder, atr14: snap?.atr14 ?? null, lastLadderEditAt: null, now: at })?.floor?.price ?? null;
        input.declinedSale = declinedSaleWork({ status, direction, decline: folded, floorPrice: floor, currentPrice: price, recentLow: null, now: at });
      }
    }
    // The research's age is classified against the wall clock, not `at`, so
    // the recording's own `researchAge` (as of the day) decides that one.
    const freshThen = (row.researchAge as { freshness?: string } | null)?.freshness === "fresh";
    const needs = computeNeedsAction(input).filter((n) => !(freshThen && n.kind === "RESEARCH_STALE"));
    const unanswered = stockContextFor({ ticker, rows: rowsThen, triggers: ladder, now: at, currentPrice: price }).unansweredDecision != null;
    const sources: SituationSources = {
      needs, triggers: ladder, status, direction,
      planSanity: (resolved?.planSanity as Array<{ kind: string }> | null) ?? null,
      actionability: (resolved?.actionability as string | null) ?? null,
      progressToTarget: num(resolved?.progressToTarget),
      buyBlockedByFull: row.buyBlockedByFull != null,
      nameTheSetup: row.nameTheSetup != null,
      unansweredDecision: unanswered,
    };
    const situations = situationsFor(sources);
    const recordedLead = (row.needsAction as { kind?: string } | null)?.kind ?? null;
    if ((needs[0]?.kind ?? null) !== recordedLead) {
      leadDiffers++;
      console.warn(`  ${ticker} at ${at.toISOString()}: recorded lead ${recordedLead ?? "none"}, recomputed ${needs[0]?.kind ?? "none"}; situations ${situations.join(",") || "none"}`);
    }

    const facts: Record<(typeof ROW_FACTS)[number], unknown> = { position, proposals: awaiting, price: priceFact, chart, inheritedTriggers };
    Object.assign(row, facts, { situations });
    filled++;
  }

  const note = `Back-filled ${TODAY} (step 8): ${ROW_FACTS.join(", ")} and situations on every recorded get_theses full row, as of each row's resolved.resolvedAt; today's inherited rules against today's stored triggers; the chart absent where no snapshot existed by then${chartless.length ? ` (${Array.from(new Set(chartless)).join(", ")})` : ""}. context and principalDirective are as recorded.`;
  c.source = { ...(c.source ?? {}), notes: [...((c.source?.notes as string[] | undefined) ?? []).filter((n) => !n.startsWith("Back-filled ")), note] };
  // The file's own style: three of the recorded cases escape every
  // non-ASCII character as \uXXXX, the rest keep them. Kept as found, so
  // the diff is the facts and nothing else.
  const escaped = /\\u[0-9a-fA-F]{4}/.test(original) && !/[^\x00-\x7f]/.test(original);
  const text = escaped
    ? JSON.stringify(c, null, 1).replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)
    : JSON.stringify(c, null, 1);
  if (!dryRun) writeFileSync(file, text);
  console.log(`${name}: ${filled} rows in ${reads.length} read${reads.length === 1 ? "" : "s"}; ${before.toLocaleString("en-US")} → ${Buffer.byteLength(text).toLocaleString("en-US")} bytes${leadDiffers ? `; ${leadDiffers} lead${leadDiffers === 1 ? "" : "s"} differ` : ""}${dryRun ? " (dry run, not written)" : ""}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const names = args.filter((a) => !a.startsWith("--"));
  const all = readdirSync("scripts/hero-cases").filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  for (const name of names.length ? names : all) await backfill(name, dryRun);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
