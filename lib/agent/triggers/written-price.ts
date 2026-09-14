/**
 * A buy fires on the crossing — true now, false at the prior close. A level
 * written after that close is measured from the price it was written at
 * instead, until the next close; otherwise "buy above $100.05" set at $100
 * the day after a $103 close is already true at that close and never fires.
 * Pure.
 */

import { priorSessionCloseAt } from "@/lib/market-hours";
import type { Trigger } from "./types";

/** The price to evaluate "was it already true?" at. Null = no baseline (level semantics). */
export function crossingBaseline(
  trigger: Pick<Trigger, "writtenPrice" | "writtenAt">,
  prevClose: number | null | undefined,
  now: Date,
): number | null {
  if (trigger.writtenPrice != null && trigger.writtenPrice > 0 && trigger.writtenAt) {
    const written = new Date(trigger.writtenAt).getTime();
    if (Number.isFinite(written) && written > priorSessionCloseAt(now).getTime()) {
      return trigger.writtenPrice;
    }
  }
  return prevClose != null && prevClose > 0 ? prevClose : null;
}

/**
 * Stamp the live price on every buy trigger this write added or changed; keep
 * the stamp on the rest. Supplied stamps are never trusted.
 */
export function stampWrittenPrice(
  before: Trigger[],
  after: Trigger[],
  price: number | null | undefined,
  now: Date,
): Trigger[] {
  const prior = new Map(before.map((t) => [t.id, t]));
  const livePrice = price != null && Number.isFinite(price) && price > 0 ? price : null;
  return after.map((t) => {
    const { writtenPrice: _p, writtenAt: _a, ...rest } = t;
    void _p;
    void _a;
    if (t.action !== "ENTER") return rest;
    const was = prior.get(t.id);
    const unchanged =
      was && was.action === "ENTER" && JSON.stringify(was.predicate) === JSON.stringify(t.predicate);
    if (unchanged) {
      return was.writtenPrice != null && was.writtenAt
        ? { ...rest, writtenPrice: was.writtenPrice, writtenAt: was.writtenAt }
        : rest;
    }
    return livePrice != null ? { ...rest, writtenPrice: livePrice, writtenAt: now.toISOString() } : rest;
  });
}
