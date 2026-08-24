"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { setPinnedTicker } from "@/lib/actions/pins.actions";

/**
 * Shared client-side pin state. ONE cache + ONE fetch behind every pin
 * affordance — the kebab item on every trade row, the header button on the
 * stock / trade / thesis surfaces.
 *
 * Rows render in long lists all over the app, so pin state can't be a prop
 * threaded through every call site. Same pattern as useTickerQuote: a
 * module-level cache, one in-flight fetch, subscribers notified on change.
 *
 * `null` means "not loaded yet" and is deliberately distinct from an empty
 * set ("loaded, nothing pinned") — the dashboard rail shows its
 * server-rendered list until the client cache actually lands, and it can only
 * tell those apart if not-loaded has its own value.
 */

let cache: Set<string> | null = null;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(pinned: Set<string>) => void>();

function publish() {
  if (!cache) return;
  const snapshot = new Set(cache);
  for (const fn of subscribers) fn(snapshot);
}

function load(): void {
  if (cache || inFlight) return;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/pins");
      if (!res.ok) return; // leave the cache unset so the next mount retries
      const json = await res.json();
      cache = new Set<string>(json.tickers ?? []);
      publish();
    } catch {
      // Network blip: deliberately do NOT cache an empty set. Poisoning the
      // cache here would silently drop every pin for the rest of the session
      // with no way to recover short of a reload.
    } finally {
      inFlight = null;
    }
  })();
}

/** Subscribe to the shared cache. Returns null until the first load lands. */
function usePinnedSet(): Set<string> | null {
  const [pinnedSet, setPinnedSet] = useState<Set<string> | null>(() =>
    cache ? new Set(cache) : null,
  );
  useEffect(() => {
    subscribers.add(setPinnedSet);
    load();
    return () => {
      subscribers.delete(setPinnedSet);
    };
  }, []);
  return pinnedSet;
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
  const pinnedSet = usePinnedSet();
  const pinned = symbol != null && (pinnedSet?.has(symbol) ?? false);

  const toggle = useCallback(async () => {
    if (!symbol) return { ok: false, pinned: false, error: "Missing ticker" };
    const next = !(cache?.has(symbol) ?? false);
    const apply = (add: boolean) => {
      cache = new Set(cache ?? []);
      if (add) cache.add(symbol);
      else cache.delete(symbol);
      publish();
    };
    apply(next);

    const res = await setPinnedTicker(symbol, next);
    if (!res.ok) apply(!next);
    return res;
  }, [symbol]);

  return { pinned, toggle };
}

/** The full pinned list. Null until the cache loads — see the note above. */
export function usePinnedList(): string[] | null {
  const pinnedSet = usePinnedSet();
  return useMemo(() => (pinnedSet ? [...pinnedSet] : null), [pinnedSet]);
}
