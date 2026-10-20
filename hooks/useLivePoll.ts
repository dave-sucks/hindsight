"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isMarketOpen } from "@/lib/market-hours";

/**
 * Keeps prices on screen current without a manual refresh.
 *
 * One rule for every live surface: re-pull every `LIVE_POLL_MS` while the tab
 * is visible and the market is open (plus one pass just after the bell, so the
 * close lands). A hidden tab or a closed market polls nothing — outside the
 * session the price is the last close and does not move. Coming back to the
 * tab re-pulls once if the data is due.
 */

export const LIVE_POLL_MS = 30_000;

/** Is a poll worth making right now? */
export function isLiveNow(now = Date.now()): boolean {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  return isMarketOpen(new Date(now)) || isMarketOpen(new Date(now - LIVE_POLL_MS * 2));
}

/**
 * Calls `poll` on the live cadence until the returned stop function is
 * called. Does not call it immediately. For module-level pollers; components
 * use `useLivePoll`.
 */
export function startLivePoll(poll: () => void, intervalMs = LIVE_POLL_MS): () => void {
  let last = Date.now();
  const run = () => {
    if (!isLiveNow()) return;
    last = Date.now();
    poll();
  };
  const id = setInterval(run, intervalMs);
  const onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - last >= intervalMs) run();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Calls `poll` on the live cadence while the component is mounted. */
export function useLivePoll(poll: () => void, intervalMs = LIVE_POLL_MS): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;
  useEffect(() => startLivePoll(() => pollRef.current(), intervalMs), [intervalMs]);
}

/**
 * Re-renders the current server page on the live cadence. `router.refresh()`
 * re-runs the server components and merges the result in place — no scroll
 * jump, client state kept — so every price, P&L and total on the page moves
 * together from the one server computation.
 */
export function useLiveRefresh(): void {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useLivePoll(() => {
    if (pendingRef.current) return; // the last refresh hasn't landed yet
    startTransition(() => router.refresh());
  });
}
