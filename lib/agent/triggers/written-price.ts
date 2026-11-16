/**
 * A buy or a review fires on the crossing — true now, false at the prior
 * close. A level written after that close is measured from the price it was
 * written at instead, until the next close; otherwise "buy above $100.05" set
 * at $100 the day after a $103 close is already true at that close and never
 * fires. Pure.
 */

import { priorSessionCloseAt } from "@/lib/market-hours";
import { samePredicate } from "./condition/stored";
import type { Trigger } from "./types";

/** A buy and a review fire on the crossing of their level; a sale, trim or add is a standing order. */
export const firesOnTheCrossing = (action: string): boolean => action === "ENTER" || action === "REVIEW";

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
 * Stamp every buy or review trigger this write added or changed with the time
 * it was written, and with the live price when one is fresh; keep the stamp
 * on the rest. Supplied stamps are never trusted.
 *
 * The time is stamped with no price too: a write before the open has no live
 * price (the PRAX filing rules, 2026-11-16 08:02), and a filing rule reads
 * its time to tell the filings it could not have missed from the ones that
 * came out first (`filingsSince`, lib/market-data/sec-events). The baseline
 * above needs both, so a time alone never moves it.
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
    if (!firesOnTheCrossing(t.action)) return rest;
    const was = prior.get(t.id);
    const unchanged =
      was && was.action === t.action && samePredicate(was.predicate, t.predicate);
    if (unchanged) {
      return was.writtenAt
        ? { ...rest, ...(was.writtenPrice != null ? { writtenPrice: was.writtenPrice } : {}), writtenAt: was.writtenAt }
        : rest;
    }
    return { ...rest, ...(livePrice != null ? { writtenPrice: livePrice } : {}), writtenAt: now.toISOString() };
  });
}
