/**
 * trade-opened email — fires from place_trade after an Alpaca fill.
 *
 * Renders the unified trade-card primitive. Backwards-compatible signature:
 * the caller in place-trade.ts passes the same fields it did pre-unification
 * plus new optionals (environment, positionId, openedAt, tickerName). The
 * positionId enables the "Open" CTA; without it, the CTA still renders but
 * points at /trades.
 */

import {
  renderTradeCard,
  tradeDetailUrl,
  tradesIndexUrl,
} from "./trade-card";

export interface TradeOpenedData {
  ticker: string;
  /** Optional human company name — rendered below the ticker on the stock row. */
  tickerName?: string | null;
  direction: "LONG" | "SHORT";
  qty: number;
  avgCost: number;
  /** Live mid quote at email-send time. Optional — falls back to avgCost. */
  currentPrice?: number | null;
  stopLoss?: number | null;
  targetPrice?: number | null;
  analystName: string;
  thesisSummary?: string | null;
  /** PAPER / LIVE — drives the env badge. Defaults to PAPER for backcompat. */
  environment?: "PAPER" | "LIVE";
  /** Position row id — used to deep-link the Open CTA. */
  positionId?: string | null;
  openedAt?: Date | null;
}

export function tradeOpenedHtml(d: TradeOpenedData): string {
  return renderTradeCard({
    analystName: d.analystName,
    action: "BUY",
    tense: "EXECUTED",
    direction: d.direction,
    environment: d.environment ?? "PAPER",
    ticker: d.ticker,
    tickerName: d.tickerName ?? null,
    qty: d.qty,
    entryPrice: d.avgCost,
    currentPrice: d.currentPrice ?? null,
    targetPrice: d.targetPrice ?? null,
    stopLoss: d.stopLoss ?? null,
    marketValue: d.qty * d.avgCost,
    openedAt: d.openedAt ?? new Date(),
    reasoning: d.thesisSummary ?? null,
    hindsightUrl: d.positionId ? tradeDetailUrl(d.positionId) : tradesIndexUrl(),
  });
}
