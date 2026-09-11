/**
 * benchmark-bars.ts — SPY and sector-ETF daily bars, fetched once and shared.
 *
 * Every get_stock_data call measures relative strength against SPY and the
 * stock's sector ETF. A run researches a dozen names, most in two or three
 * sectors — without sharing, that's a dozen identical year-long SPY pulls.
 * The promise is memoized (so parallel calls in one run share one fetch) for
 * BENCHMARK_TTL_MS, then refetched.
 *
 * These are completed DAILY bars, not a live quote — the CLAUDE.md rule
 * against caching "the price right now" is about quotes, and a finished
 * session's bar doesn't change. A failed fetch is evicted immediately so the
 * next caller retries rather than inheriting the failure.
 */

import { getDailyBars, type AlpacaCredentials } from "@/lib/alpaca";
import type { DailyBar } from "@/lib/market-data/price-structure";

export const BENCHMARK_TTL_MS = 15 * 60_000;
export const CHART_SESSIONS = 260;

const cache = new Map<string, { at: number; bars: Promise<DailyBar[]> }>();

export function getBenchmarkBars(
  symbol: string,
  creds?: AlpacaCredentials,
  now: number = Date.now(),
): Promise<DailyBar[]> {
  const hit = cache.get(symbol);
  if (hit && now - hit.at < BENCHMARK_TTL_MS) return hit.bars;
  const bars = getDailyBars(symbol, CHART_SESSIONS, creds).then((r) => r.bars);
  cache.set(symbol, { at: now, bars });
  bars.catch(() => {
    if (cache.get(symbol)?.bars === bars) cache.delete(symbol);
  });
  return bars;
}
