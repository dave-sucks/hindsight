/**
 * The Trading tab on /performance: what the closed trades did, realized, on the
 * book the app is set to (Live or Paper). It is not the account's return: that
 * is net of deposits and lives on the Dashboard (lib/portfolio/contributions).
 * Built on the same closed-trade rows and arithmetic as the setup scorecard and
 * the trade-results tool (./load-setup-scorecard, ./setup-scorecard), so the
 * three can't disagree about a win rate.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/market-data/intraday-window";
import { SCORECARD_SINCE, loadClosedTrades } from "@/lib/performance/load-setup-scorecard";
import { buildScorecard, giveBackPts, setupName, tradeR, type ClosedTrade } from "@/lib/performance/setup-scorecard";

export type TradingRange = "30" | "90" | "all";

const gainPct = (t: ClosedTrade) => ((t.direction === "SHORT" ? t.entry - t.close : t.close - t.entry) / t.entry) * 100;
/** The best the trade was up while held, from the tracked high (low for a short). */
const peakGainPct = (t: ClosedTrade) =>
  t.peak == null ? null : Math.max(0, ((t.direction === "SHORT" ? t.entry - t.peak : t.peak - t.entry) / t.entry) * 100);
const daysHeld = (t: ClosedTrade) => Math.max(0, Math.round((t.closedAt.getTime() - t.openedAt.getTime()) / 86_400_000));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
const sumPnl = (ts: ClosedTrade[]) => ts.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);

const REASONS: Record<string, string> = { STOP: "Stop", TARGET: "Target", MANUAL: "Manual", TIME: "Time", PROMOTED: "Promoted" };
export const reasonName = (r: string | null | undefined) =>
  !r ? "Unknown" : REASONS[r] ?? r.charAt(0) + r.slice(1).toLowerCase().replace(/_/g, " ");

/** Where each trade's result lands, in % of what we paid. */
export const GAIN_BUCKETS: Array<{ label: string; from: number; to: number }> = [
  { label: "Below −15%", from: -Infinity, to: -15 }, { label: "−15 to −10%", from: -15, to: -10 },
  { label: "−10 to −5%", from: -10, to: -5 }, { label: "−5 to 0%", from: -5, to: 0 },
  { label: "0 to 5%", from: 0, to: 5 }, { label: "5 to 10%", from: 5, to: 10 },
  { label: "10 to 20%", from: 10, to: 20 }, { label: "Above 20%", from: 20, to: Infinity },
];

/** A trade up this much at its best that still closed at a loss is a round trip. */
export const ROUND_TRIP_PEAK_PCT = 5;

function group(trades: ClosedTrade[], key: (t: ClosedTrade) => string) {
  const out = new Map<string, ClosedTrade[]>();
  for (const t of trades) out.set(key(t), [...(out.get(key(t)) ?? []), t]);
  return [...out.entries()];
}

function stats(ts: ClosedTrade[]) {
  const wins = ts.filter((t) => gainPct(t) > 0);
  const rs = ts.map(tradeR).filter((r): r is number => r != null);
  const gbs = ts.map(giveBackPts).filter((g): g is number => g != null);
  return {
    trades: ts.length,
    winRatePct: ts.length ? Math.round((wins.length / ts.length) * 100) : 0,
    avgGainPct: round1(mean(ts.map(gainPct))),
    avgR: round1(mean(rs)),
    realizedPnl: Math.round(sumPnl(ts) * 100) / 100,
    avgHoldDays: ts.length ? Math.round(mean(ts.map(daysHeld)) as number) : 0,
    avgGiveBackPts: round1(mean(gbs)),
  };
}

/** The tab's numbers from the closed trades: those closed since `since` (all of them when null). */
export function buildTrading(all: ClosedTrade[], since: Date | null) {
  const trades = all.filter((t) => !since || t.closedAt >= since).sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  const wins = trades.filter((t) => gainPct(t) > 0);
  const losses = trades.filter((t) => gainPct(t) <= 0);
  const priced = trades.filter((t) => t.realizedPnl != null);
  const grossWin = sumPnl(priced.filter((t) => (t.realizedPnl as number) > 0));
  const grossLoss = -sumPnl(priced.filter((t) => (t.realizedPnl as number) < 0));
  const peaks = trades.map(peakGainPct);

  let running = 0;
  const curve = group(priced, (t) => etDateOf(t.closedAt)).map(([date, ts]) => {
    running += sumPnl(ts);
    return { date, realized: Math.round(sumPnl(ts) * 100) / 100, cumulative: Math.round(running * 100) / 100 };
  });

  return {
    summary: {
      ...stats(trades),
      wins: wins.length,
      losses: losses.length,
      pricedTrades: priced.length,
      trimmedTrades: trades.filter((t) => t.trimmed).length,
      avgWinPct: round1(mean(wins.map(gainPct))),
      avgLossPct: round1(mean(losses.map(gainPct))),
      profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
      roundTrips: trades.filter((t, i) => (peaks[i] ?? 0) >= ROUND_TRIP_PEAK_PCT && gainPct(t) < 0).length,
    },
    curve,
    distribution: GAIN_BUCKETS.map((b) => ({
      label: b.label, winning: b.from >= 0, n: trades.filter((t) => gainPct(t) >= b.from && gainPct(t) < b.to).length,
    })),
    exits: group(trades, (t) => reasonName(t.closeReason)).map(([reason, ts]) => ({ reason, ...stats(ts) })).sort((a, b) => b.trades - a.trades),
    // The last 20 closes: the best each was up while held, and where it closed.
    peaks: trades.slice(-20).map((t) => ({
      label: `${t.symbol ?? "?"} ${etDateOf(t.closedAt).slice(5).replace("-", "/")}`, best: round1(peakGainPct(t)), exit: round1(gainPct(t)) as number,
    })),
    byAnalyst: group(trades, (t) => t.analyst).map(([analyst, ts]) => ({ analyst, ...stats(ts) })).sort((a, b) => b.trades - a.trades),
    bySetup: buildScorecard(trades.map((t) => ({ ...t, horizon: null, analyst: "", environment: "" })))
      .map((r) => ({ setup: r.setupName, trades: r.trades, winRatePct: r.winRatePct, avgR: r.avgR, avgHoldDays: r.avgHoldDays, avgGiveBackPts: r.avgGiveBackPts }))
      .sort((a, b) => b.trades - a.trades),
    recent: [...trades].reverse().slice(0, 15).map((t) => ({
      symbol: t.symbol ?? "?", thesisId: t.thesisId ?? null, analyst: t.analyst, setup: setupName(t.setupId), closedOn: etDateOf(t.closedAt),
      entry: t.entry, close: t.close, gainPct: round1(gainPct(t)) as number, bestPct: round1(peakGainPct(t)),
      r: round1(tradeR(t)), days: daysHeld(t), reason: reasonName(t.closeReason), realizedPnl: t.realizedPnl ?? null,
    })),
  };
}

export async function loadTrading(opts: { accountId: string; environment: string; range: TradingRange; analystId: string | null; now?: Date }) {
  const now = opts.now ?? new Date();
  const since = opts.range === "all" ? null : new Date(now.getTime() - Number(opts.range) * 86_400_000);
  const [analysts, all] = await Promise.all([
    prisma.agentConfig.findMany({ where: { accountId: opts.accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    loadClosedTrades({ accountId: opts.accountId, environment: opts.environment, analystId: opts.analystId ?? undefined }),
  ]);
  return {
    environment: opts.environment, range: opts.range, analysts, analystId: opts.analystId,
    since: (since ?? SCORECARD_SINCE).toISOString(),
    ...buildTrading(all, since),
  };
}
export type Trading = Awaited<ReturnType<typeof loadTrading>>;
