/**
 * Two reads for the stock page, from the same code the triggers use:
 *   • volume — today's consolidated volume against the 20-session average,
 *     the comparison VOLUME_RATIO fires on;
 *   • insider buying — open-market purchases (Form 4 code P) in the last
 *     90 days and how many distinct people bought in the last 30, the read
 *     INSIDER_CLUSTER fires on.
 * Live, nothing stored. A read that failed says so.
 */

import { getDailyBars, getTodaySessionBars } from "@/lib/alpaca";
import {
  fetchOpenMarketBuys,
  insiderCluster,
  INSIDER_LOOKBACK_DAYS,
  type InsiderCluster,
} from "./insider-cluster";

export interface StockVolume {
  /** Today's consolidated volume through ~16 minutes ago; null before the open. */
  today: number | null;
  /** Average of the last 20 completed sessions. */
  avg20: number | null;
  /** today ÷ avg20. */
  ratio: number | null;
  /** "sip" is the whole market; "iex" is a sliver and is never shown as volume. */
  feed: "sip" | "iex" | null;
  error?: string;
}

export async function getStockVolume(symbol: string, now: Date = new Date()): Promise<StockVolume> {
  const S = symbol.toUpperCase();
  try {
    const [daily, today] = await Promise.all([getDailyBars(S, 25, undefined, now), getTodaySessionBars([S], undefined, now)]);
    if (daily.feed !== "sip") {
      return { today: null, avg20: null, ratio: null, feed: daily.feed, error: "Only the partial (IEX) feed answered — no market volume" };
    }
    const last20 = daily.bars.slice(-20).map((b) => b.volume);
    const avg20 = last20.length === 20 ? Math.round(last20.reduce((a, b) => a + b, 0) / 20) : null;
    const todayVol = today[S]?.volume ?? null;
    return {
      today: todayVol,
      avg20,
      ratio: todayVol != null && avg20 ? todayVol / avg20 : null,
      feed: "sip",
    };
  } catch (err) {
    return { today: null, avg20: null, ratio: null, feed: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface StockInsiderBuying {
  /** Every open-market buy in the last 90 days. */
  last90: InsiderCluster | null;
  /** Distinct buyers in the last 30 days — three or more is the playbook's cluster. */
  last30: InsiderCluster | null;
  error?: string;
}

export async function getInsiderBuying(symbol: string, now: Date = new Date()): Promise<StockInsiderBuying> {
  const buys = await fetchOpenMarketBuys(symbol.toUpperCase(), INSIDER_LOOKBACK_DAYS, now);
  if (buys == null) return { last90: null, last30: null, error: "Insider transactions unavailable" };
  return {
    last90: insiderCluster(buys, INSIDER_LOOKBACK_DAYS, now),
    last30: insiderCluster(buys, 30, now),
  };
}
