/**
 * buy-crossing.ts — a buy that fired and was never bought, on a stock the
 * price has since left behind (DAV-303).
 *
 * A buy fires on the CROSSING: true now, false at the prior close. Cross it
 * once without buying and the level is spent — the condition stays true and
 * never fires again. ETN's buy fired 2026-09-18 at $418 and place_trade
 * refused it (the Secular Compounder held 4 of 4); ISRG's fired 09-16 and
 * again 09-17 at $383 into the same wall. Dave raised the limit to 6 on
 * 09-21, so both seats have room — and neither buy will ever fire again.
 * ETN trades at $425, ISRG at $393. Both plans sit there looking healthy.
 *
 * They fall between every other flag: the level is slightly BELOW the price,
 * so it is not far from it (ENTRY_FAR_FROM_PRICE wants 10%), not stale, not
 * raised away. `buyBlockedByFull` (capacity.ts) said it out loud on the days
 * the analyst was full — and went quiet the moment a slot opened, which is
 * exactly when the question finally has an answer.
 *
 * So this is the other half of that flag, and the two are disjoint by design:
 * while the analyst is full the question is "which holding would it replace";
 * once it has room the question is "the crossing is spent — now what?"
 *
 * Judgment stays with the analyst. This states the arithmetic and hands over
 * the setup's own chase rule; the run re-anchors, re-prices or sets the plan
 * down. Nothing re-arms the trigger — that would rebuild the daily buy nag
 * the crossing rule exists to prevent — and nothing here refuses anything.
 *
 * Pure: reads the stock's own buy trigger and its audit rows. No DB, no
 * clock beyond `now`.
 */

import { isLadderEditUpdate } from "@/lib/agent/ladder-health";

export interface SpentBuyCrossing {
  /** The written buy level the price has left behind. */
  level: number;
  /** YYYY-MM-DD the buy last fired. */
  firedAt: string;
  /** How far past the level the stock trades today, percent. */
  pastPct: number;
  /** The setup's chase limit, percent; null = this setup has no chase rule. */
  chaseLimitPct: number | null;
  /** Is today's price still inside the chase rule? A setup with none is always inside. */
  insideChase: boolean;
}

/**
 * How long a spent crossing stays this run's question. The same 30 days
 * ENTRY_RAISE_WINDOW_DAYS uses — one window over recent buy-level history.
 * Past it the level is stale on its own terms and ENTRY_STALE (28 days)
 * or ENTRY_FAR_FROM_PRICE has taken the row over.
 */
export const SPENT_CROSSING_WINDOW_DAYS = 30;

export function spentBuyCrossing(input: {
  status: string;
  direction: string | null;
  /** The written buy level. */
  entryPrice: number | null;
  currentPrice: number | null;
  /** The stock's own buy trigger's last fire, ISO. */
  enterLastFiredAt: string | null;
  /** The setup's chase limit with the account's numbers already applied. */
  chaseLimitPct: number | null;
  /** The thesis's own audit rows; only ones after the fire are read. */
  updates: Array<{ type: string; timestamp: Date; fieldChanges: unknown }>;
  now: Date;
  windowDays?: number;
}): SpentBuyCrossing | null {
  const { status, direction, entryPrice, currentPrice, enterLastFiredAt } = input;
  if (status !== "WATCHING") return null;
  if (direction !== "LONG" && direction !== "SHORT") return null;
  if (entryPrice == null || entryPrice <= 0) return null;
  if (currentPrice == null || currentPrice <= 0) return null;
  if (!enterLastFiredAt) return null;

  const fired = new Date(enterLastFiredAt);
  if (Number.isNaN(fired.getTime())) return null;
  const ageDays = (input.now.getTime() - fired.getTime()) / 86_400_000;
  if (ageDays < 0 || ageDays > (input.windowDays ?? SPENT_CROSSING_WINDOW_DAYS)) return null;

  // Spent means the price is PAST the level in the trade's direction. Back
  // under it and the buy can cross again — nothing to answer.
  const isLong = direction === "LONG";
  const pastPct = isLong
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;
  if (pastPct <= 0) return null;

  // Answered = the plan was re-anchored, re-priced or set down after the
  // fire. Every one of those writes a ladder edit (`triggerOps` / `triggers`
  // / `stopLoss` / `fireMode`); a rationale-only "full — waiting" row does
  // not, which is the whole point — ETN and ISRG each got one of those and
  // the plan was left exactly as it was.
  const answered = input.updates.some(
    (u) => u.timestamp.getTime() > fired.getTime() && isLadderEditUpdate(u.type, u.fieldChanges),
  );
  if (answered) return null;

  const chaseLimitPct = input.chaseLimitPct;
  return {
    level: entryPrice,
    firedAt: fired.toISOString().slice(0, 10),
    pastPct,
    chaseLimitPct,
    insideChase: chaseLimitPct == null || pastPct <= chaseLimitPct,
  };
}
