/**
 * regime.ts — what the market allows today (TRADING_PLAYBOOK.md Part C).
 *
 *   RISK_OFF  SPY more than 1% below its 200-day
 *   CAUTION   SPY more than 1% below its 50-day (not RISK_OFF)
 *   RISK_ON   otherwise
 *
 * The 1% buffer (REGIME_BUFFER_PCT, Dave 2026-09-11): a line with no
 * buffer flips on noise — on 2026-09-10 SPY closed 42¢ under its 50-day
 * and every buy would have been halved.
 *
 * Plus breadth: the share of the book's names above their own 50-day,
 * reported alongside (the playbook's RISK_ON also asks for ≥ 60%; it is a
 * line the principal reads, not a switch, because four names can swing it).
 *
 * An INPUT, never a gate (DAV-251, AGENT_REBUILD.md §2.4): CAUTION halves
 * the suggested size and every buy proposal carries the regime line.
 * Nothing refuses on it. Read from the daily indicator snapshot (SPY is
 * snapshotted with the book), so it is as of the last close.
 */

import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import type { Regime } from "@/lib/agent/position-sizing";

export const BREADTH_RISK_ON_PCT = 60;
/** SPY must be this far under an average before it counts as below it. */
export const REGIME_BUFFER_PCT = 1;

export interface RegimeReading {
  regime: Regime;
  /** SPY's last close and its averages. */
  spyClose: number;
  spy50: number;
  spy200: number;
  /** % of the book's names above their own 50-day, when there's a book. */
  breadthPct: number | null;
  line: string;
}

export function computeRegime(
  spy: IndicatorSnapshot | null | undefined,
  book: IndicatorSnapshot[],
): RegimeReading | null {
  if (!spy) return null;
  const close = spy.closes[spy.closes.length - 1];
  const s50 = spy.sma[50];
  const s200 = spy.sma[200];
  if (close == null || s50 == null || s200 == null) return null;

  const under = (avg: number) => close < avg * (1 - REGIME_BUFFER_PCT / 100);
  const regime: Regime = under(s200) ? "RISK_OFF" : under(s50) ? "CAUTION" : "RISK_ON";
  const withAvg = book.filter((b) => b.sma[50] != null && b.closes.length > 0);
  const breadthPct = withAvg.length
    ? Math.round((withAvg.filter((b) => b.closes[b.closes.length - 1] > (b.sma[50] as number)).length / withAvg.length) * 100)
    : null;

  const pos = (v: number, avg: number, label: string) => `${v >= avg ? "above" : "below"} its ${label} ($${avg.toFixed(2)})`;
  const what =
    regime === "RISK_OFF"
      ? "new longs for event trades and mean-reversion only"
      : regime === "CAUTION"
        ? "half size on new entries; breakouts fail most here"
        : "full size";
  const line =
    `Regime ${regime}: SPY $${close.toFixed(2)}, ${pos(close, s50, "50-day")}, ${pos(close, s200, "200-day")} — ${what}.` +
    (breadthPct != null ? ` ${breadthPct}% of the book is above its 50-day${regime === "RISK_ON" && breadthPct < BREADTH_RISK_ON_PCT ? ` (under ${BREADTH_RISK_ON_PCT}% — thin leadership)` : ""}.` : "");
  return { regime, spyClose: close, spy50: s50, spy200: s200, breadthPct, line };
}
