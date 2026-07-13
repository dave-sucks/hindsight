import { getLatestPrice } from "@/lib/alpaca";

/**
 * Live exit price for a close proposal's NOTIFICATIONS (email + push).
 *
 * Uses Alpaca's real-time last trade — the same venue that will actually
 * fill the approved order — NOT Finnhub `/quote.c`, which returns a stale
 * PRIOR CLOSE in the minutes after market open. That was the 2026-07-13
 * XENE bug: the close email showed exit $68.92 (the previous day's close)
 * and "+29.2%" while XENE was live ~$66.14 (+23.9%), a price never hit that
 * day. Alpaca last-trade does not have that failure mode.
 *
 * Returns null when no real-time trade is available (Alpaca's IEX feed has
 * spotty coverage off-hours / for thin names). Callers MUST treat null as
 * "unknown" — render an em dash and suppress P&L — and must NEVER fall back
 * to a stale quote or a false $0. A missing number is correct; a wrong one
 * is not.
 *
 * In-app views are unaffected: they re-quote live on every render and stay
 * live by design. This helper only backs the point-in-time notifications.
 */
export async function getLiveExitPrice(symbol: string): Promise<number | null> {
  try {
    const price = await getLatestPrice(symbol);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
