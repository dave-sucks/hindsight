/**
 * trade-results.ts — what the closed book actually did, as plain rows
 * (DAV-295). Pure: the arithmetic lives here so the chat tool and its tests
 * read the same numbers the /performance page does.
 *
 * Realized trade P&L only. It is NOT the account's return: a deposit raises
 * equity without being a gain, and account-level return is measured against
 * net contributed capital in lib/portfolio/contributions.ts. Quoting the sum
 * of closed trades as "how the account did" is the 2026-06-07 bug in a new
 * costume, so this module never claims to.
 */

import { buildScorecard, setupName, tradeR, type ClosedTrade } from "./setup-scorecard";

export interface TradeLine {
  symbol: string;
  analyst: string;
  setup: string;
  direction: string;
  entry: number;
  close: number;
  gainPct: number;
  /** Gain in units of the risk taken at the buy; null when the entry stop is unknown. */
  r: number | null;
  daysHeld: number;
  realizedPnl: number | null;
  closeReason: string | null;
  closedAt: Date;
}

export interface TradeResults {
  trades: number;
  wins: number;
  winRatePct: number;
  avgR: number | null;
  rTrades: number;
  avgHoldDays: number;
  /** Realized dollars across the window, where Alpaca recorded them. */
  realizedPnl: number | null;
  /** How many trades carried a realized figure — the sum means nothing without it. */
  realizedTrades: number;
  /**
   * Trades that were trimmed before the final close. `Position.realizedPnl`
   * records only the closing leg, so the dollars above understate those by
   * whatever the trims banked. Named rather than silently dropped.
   */
  trimmedTrades: number;
  bySetup: Array<{ setup: string; trades: number; winRatePct: number; avgR: number | null; avgHoldDays: number; avgGiveBackPts: number | null }>;
  byAnalyst: Array<{ analyst: string; trades: number; winRatePct: number; avgR: number | null }>;
  recent: TradeLine[];
}

const gainPct = (t: ClosedTrade) =>
  t.direction === "SHORT" ? ((t.entry - t.close) / t.entry) * 100 : ((t.close - t.entry) / t.entry) * 100;

// R is computed in exactly one place — lib/performance/setup-scorecard's
// tradeR, the same function the /performance page and the scorecard use. A
// second implementation here meant the headline and the per-setup line could
// disagree inside one answer (QB review, 2026-09-19).
const rOf = (t: ClosedTrade): number | null => {
  const r = tradeR(t);
  return r == null ? null : Math.round(r * 10) / 10;
};

const days = (t: ClosedTrade) =>
  Math.max(0, Math.round((t.closedAt.getTime() - t.openedAt.getTime()) / 86_400_000));

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function toTradeLine(t: ClosedTrade): TradeLine {
  return {
    symbol: t.symbol ?? "?",
    analyst: t.analyst,
    setup: setupName(t.setupId),
    direction: t.direction,
    entry: t.entry,
    close: t.close,
    gainPct: Math.round(gainPct(t) * 10) / 10,
    r: rOf(t),
    daysHeld: days(t),
    realizedPnl: t.realizedPnl ?? null,
    closeReason: t.closeReason ?? null,
    closedAt: t.closedAt,
  };
}

export function buildTradeResults(trades: ClosedTrade[], recentLimit = 10): TradeResults {
  const wins = trades.filter((t) => gainPct(t) > 0).length;
  const rs = trades.map(rOf).filter((r): r is number => r != null);
  const withPnl = trades.filter((t) => t.realizedPnl != null);
  const byAnalyst = new Map<string, ClosedTrade[]>();
  for (const t of trades) byAnalyst.set(t.analyst, [...(byAnalyst.get(t.analyst) ?? []), t]);

  return {
    trades: trades.length,
    wins,
    winRatePct: trades.length ? Math.round((wins / trades.length) * 100) : 0,
    avgR: rs.length ? Math.round((mean(rs) as number) * 10) / 10 : null,
    rTrades: rs.length,
    avgHoldDays: trades.length ? Math.round(mean(trades.map(days)) as number) : 0,
    realizedPnl: withPnl.length ? Math.round(withPnl.reduce((a, t) => a + (t.realizedPnl as number), 0) * 100) / 100 : null,
    realizedTrades: withPnl.length,
    trimmedTrades: trades.filter((t) => t.trimmed).length,
    // The same builder the /performance page uses, so the chat and the page
    // can never disagree about a win rate.
    bySetup: buildScorecard(trades.map((t) => ({ ...t, horizon: null, analyst: "", environment: "" })))
      .map((r) => ({ setup: r.setupName, trades: r.trades, winRatePct: r.winRatePct, avgR: r.avgR, avgHoldDays: r.avgHoldDays, avgGiveBackPts: r.avgGiveBackPts }))
      .sort((a, b) => b.trades - a.trades),
    byAnalyst: [...byAnalyst.entries()]
      .map(([analyst, ts]) => {
        const w = ts.filter((t) => gainPct(t) > 0).length;
        const r = ts.map(rOf).filter((x): x is number => x != null);
        return {
          analyst,
          trades: ts.length,
          winRatePct: Math.round((w / ts.length) * 100),
          avgR: r.length ? Math.round((mean(r) as number) * 10) / 10 : null,
        };
      })
      .sort((a, b) => b.trades - a.trades),
    recent: [...trades]
      .sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime())
      .slice(0, recentLimit)
      .map(toTradeLine),
  };
}

/** The headline, in one sentence. `book` is PAPER or LIVE — never left unsaid. */
export function resultsHeadline(r: TradeResults, windowLabel: string, book?: string | null): string {
  const scope = book ? ` on the ${book.toLowerCase()} book` : "";
  if (r.trades === 0) return `No closed trades ${windowLabel}${scope}.`;
  const parts = [
    `${r.trades} closed trade${r.trades === 1 ? "" : "s"} ${windowLabel}${scope}`,
    `${r.winRatePct}% win (${r.wins} of ${r.trades})`,
  ];
  if (r.avgR != null) parts.push(`${r.avgR >= 0 ? "+" : ""}${r.avgR}R average over the ${r.rTrades} with a readable entry stop`);
  parts.push(`${r.avgHoldDays} days held on average`);
  if (r.realizedPnl != null) {
    parts.push(
      `${r.realizedPnl >= 0 ? "+" : "−"}$${Math.abs(r.realizedPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })} realized on the ${r.realizedTrades} the broker priced`,
    );
  }
  const caveat =
    r.trimmedTrades > 0
      ? ` The dollars are the closing leg only: ${r.trimmedTrades} of these ${r.trimmedTrades === 1 ? "was" : "were"} trimmed first, and what those trims banked is not counted.`
      : "";
  return `${parts.join(" · ")}. Realized trade P&L, not the account's return.${caveat}`;
}
