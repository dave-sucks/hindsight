/**
 * trade-closed email — fires when an Alpaca exit fills.
 *
 * Renders the unified trade-card primitive. The shared template puts the
 * realized gain inline on the h1 header ("Sold N MRVL for +31.5%") and on a
 * pill next to the ticker in the stock row.
 */

import { renderTradeCard, tradeDetailUrl } from "./trade-card";

const REASON_LABELS: Record<string, string> = {
  TARGET: "Price target reached.",
  STOP: "Stop loss hit.",
  TIME: "Time-based exit triggered.",
  MANUAL: "Manually closed by the operator.",
};

export interface TradeClosedData {
  ticker: string;
  /** Optional human company name — rendered below the ticker on the stock row. */
  tickerName?: string | null;
  direction: "LONG" | "SHORT";
  qty?: number;
  entryPrice: number;
  closePrice: number;
  /** Live mid quote at email-send time. Defaults to closePrice. */
  currentPrice?: number | null;
  realizedPnl: number;
  realizedPnlPct: number;
  /** Unused by the renderer now — outcome shows via the gain color. Kept for callsite backcompat. */
  outcome?: "WIN" | "LOSS" | "BREAKEVEN";
  closeReason: string;
  daysHeld: number;
  /** Position row id — used to deep-link the Open CTA. Same field name (tradeId) as before. */
  tradeId: string;

  /** Optional analyst name for the header. Defaults to "Hindsight" when omitted. */
  analystName?: string;
  environment?: "PAPER" | "LIVE";
  openedAt?: Date | null;
  closedAt?: Date | null;
}

export function tradeClosedHtml(d: TradeClosedData): string {
  const qty = d.qty ?? estimateQty(d);
  const marketValue = qty * d.closePrice;
  const reasoning = REASON_LABELS[d.closeReason] ?? d.closeReason;

  return renderTradeCard({
    analystName: d.analystName ?? "Hindsight",
    action: "SELL",
    tense: "EXECUTED",
    direction: d.direction,
    environment: d.environment ?? "PAPER",
    ticker: d.ticker,
    tickerName: d.tickerName ?? null,
    qty,
    entryPrice: d.entryPrice,
    exitPrice: d.closePrice,
    currentPrice: d.currentPrice ?? d.closePrice,
    marketValue,
    realizedPnl: d.realizedPnl,
    realizedPnlPct: d.realizedPnlPct,
    openedAt: d.openedAt ?? null,
    closedAt: d.closedAt ?? new Date(),
    reasoning,
    hindsightUrl: tradeDetailUrl(d.tradeId),
  });
}

/**
 * Recover share count from realized P&L when the caller didn't supply it.
 *
 *   pnl = (close − entry) × qty   →   qty = pnl / (close − entry)
 *
 * Floors to ≥ 1 so we never render "0 shares of MRVL" on a degenerate
 * breakeven close.
 */
function estimateQty(d: TradeClosedData): number {
  const dp = d.closePrice - d.entryPrice;
  if (Math.abs(dp) < 1e-6) return 1;
  return Math.max(1, Math.round(d.realizedPnl / dp));
}
