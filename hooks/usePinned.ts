"use client";

import { useCallback, useEffect, useState } from "react";
import { setPinnedTicker } from "@/lib/actions/pins.actions";

/**
 * Shared client-side pin state. ONE cache + ONE fetch behind every pin
 * affordance — the kebab item on every trade row, the header button on the
 * stock / trade / thesis surfaces.
 *
 * Rows are rendered in long lists all over the app, so pin state can't be a
 * prop threaded through every call site. Same pattern as useTickerQuote: a
 * module-level cache, one in-flight fetch, subscribers notified on change.
 */

let cache: Set<string> | null = null;
let inFlight: Promise<Set<string>> | null = null;
const subscribers = new Set<(pinned: Set<string>) => void>();

function publish() {
  const snapshot = new Set(cache ?? []);
  for (const fn of subscribers) fn(snapshot);
}

async function load(): Promise<Set<string>> {
  if (cache) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/pins");
      const json = res.ok ? await res.json() : { tickers: [] };
      cache = new Set<string>(json.tickers ?? []);
    } catch {
      cache = new Set<string>();
    } finally {
      inFlight = null;
    }
    publish();
    return cache!;
  })();
  return inFlight;
}

/** Drop the cache so the next subscriber refetches (after a server mutation). */
export function invalidatePinned() {
  cache = null;
  void load();
}

/**
 * Pin state + toggle for one ticker. Optimistic: the icon flips immediately
 * and reverts if the write is refused (not signed in, pin cap reached).
 */
export function usePinned(ticker: string | undefined): {
  pinned: boolean;
  toggle: () => Promise<{ ok: boolean; pinned: boolean; error?: string }>;
} {
  const symbol = ticker?.toUpperCase();
  const [pinnedSet, setPinnedSet] = useState<Set<string>>(() => new Set(cache ?? []));

  useEffect(() => {
    subscribers.add(setPinnedSet);
    void load();
    return () => {
      subscribers.delete(setPinnedSet);
    };
  }, []);

  const pinned = symbol != null && pinnedSet.has(symbol);

  const toggle = useCallback(async () => {
    if (!symbol) return { ok: false, pinned: false, error: "Missing ticker" };
    const next = !(cache?.has(symbol) ?? false);
    // Optimistic local write, published to every subscribed row at once.
    cache = new Set(cache ?? []);
    if (next) cache.add(symbol);
    else cache.delete(symbol);
    publish();

    const res = await setPinnedTicker(symbol, next);
    if (!res.ok) {
      cache = new Set(cache ?? []);
      if (next) cache.delete(symbol);
      else cache.add(symbol);
      publish();
    }
    return res;
  }, [symbol]);

  return { pinned, toggle };
}

/** The full pinned list, in server order. Used by the dashboard rail. */
export function usePinnedList(): string[] | null {
  const [, setPinnedSet] = useState<Set<string>>(() => new Set(cache ?? []));
  useEffect(() => {
    subscribers.add(setPinnedSet);
    void load();
    return () => {
      subscribers.delete(setPinnedSet);
    };
  }, []);
  return cache ? [...cache] : null;
}
