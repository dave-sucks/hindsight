"use client";

import { useEffect, useState } from "react";

/**
 * Shared client-side quote source. ONE cache + ONE fetch path behind every
 * place that shows a live price / day change — ticker chips, thesis cards, the
 * watchlist rows. All of it hits `/api/quotes` (Finnhub `c/d/dp/pc`). Do not
 * add a second quote fetcher; extend this.
 */

export interface QuoteData {
  symbol: string;
  price: number;
  change: number; // $ change from prev close
  changePct: number; // % change from prev close (the day's move)
  prevClose: number;
}

const quoteCache = new Map<string, { data: QuoteData; fetchedAt: number }>();
const pendingFetches = new Map<string, Promise<QuoteData | null>>();
const CACHE_TTL_MS = 30_000; // 30s — matches Finnhub revalidate

export async function fetchQuote(symbol: string): Promise<QuoteData | null> {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  // Deduplicate concurrent requests for the same symbol
  const pending = pendingFetches.get(symbol);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbol)}`);
      if (!res.ok) return null;
      const json = await res.json();
      const quote = json.quotes?.[0] as QuoteData | undefined;
      if (quote && quote.price > 0) {
        quoteCache.set(symbol, { data: quote, fetchedAt: Date.now() });
        return quote;
      }
      return null;
    } catch {
      return null;
    } finally {
      pendingFetches.delete(symbol);
    }
  })();

  pendingFetches.set(symbol, promise);
  return promise;
}

/** Batch-warm the cache for many symbols at once (e.g. before a list renders). */
export function usePrefetchTickers(symbols: string[]) {
  useEffect(() => {
    if (symbols.length === 0) return;
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const toFetch = unique.filter((s) => {
      const cached = quoteCache.get(s);
      return !cached || Date.now() - cached.fetchedAt >= CACHE_TTL_MS;
    });
    if (toFetch.length === 0) return;

    fetch(`/api/quotes?symbols=${toFetch.join(",")}`)
      .then((r) => r.json())
      .then((json) => {
        for (const q of json.quotes ?? []) {
          if (q.price > 0) {
            quoteCache.set(q.symbol, { data: q, fetchedAt: Date.now() });
          }
        }
      })
      .catch(() => {});
  }, [symbols.join(",")]);
}

/** Reactive single-symbol quote from the shared cache/fetch path. */
export function useTickerQuote(symbol: string | undefined): QuoteData | null {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  useEffect(() => {
    if (!symbol) return;
    let active = true;
    fetchQuote(symbol.toUpperCase()).then((q) => {
      if (active && q) setQuote(q);
    });
    return () => {
      active = false;
    };
  }, [symbol]);
  return quote;
}
