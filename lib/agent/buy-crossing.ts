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
 * **Which way "past the level" runs is the PREDICATE's to say, never the
 * trade direction's.** A LONG can be bought on a breakout (`PRICE_ABOVE`) or
 * on a pullback (`PRICE_BELOW`), and the two are opposites: LUXE buys at
 * `PRICE_BELOW $9.10` — "the non-chase PEAD entry" — and traded at $10.08 on
 * 2026-09-21. Reading that as a spent crossing would have told the run to
 * re-anchor a deliberate pullback level up onto the tape, which is the exact
 * chase the level exists to avoid. AGIO ($31.50) and NOW ($130) are the same
 * shape. Only a plain price level can be read this way at all; a `VS_SMA`,
 * `NEAR_SMA` or composite entry (GD, GEV, SYK) returns nothing.
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
import type { TriggerPredicate } from "@/lib/agent/triggers/types";

export interface SpentBuyCrossing {
  /** The level the buy trigger actually fires on, and the price has left behind. */
  level: number;
  /** Which way the buy fires: up through the level, or down to it. */
  crossing: "ABOVE" | "BELOW";
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

/**
 * The level a buy fires on, and which way it crosses it. Null for every
 * predicate that is not a plain price level — a moving-average reclaim, a
 * volume condition or a composite has no single number the price can be
 * "past", and guessing one is how a pullback entry gets read backwards.
 */
function crossingLevel(
  p: TriggerPredicate | null | undefined,
): { level: number; crossing: "ABOVE" | "BELOW" } | null {
  if (!p) return null;
  if (p.kind === "PRICE_ABOVE" && typeof p.level === "number" && p.level > 0) {
    return { level: p.level, crossing: "ABOVE" };
  }
  if (p.kind === "PRICE_BELOW" && typeof p.level === "number" && p.level > 0) {
    return { level: p.level, crossing: "BELOW" };
  }
  return null;
}

export function spentBuyCrossing(input: {
  status: string;
  direction: string | null;
  currentPrice: number | null;
  /**
   * The stock's own buy trigger — its predicate (which decides the level and
   * the direction of the crossing) and its last fire. Null when it has none.
   */
  enter: { predicate: TriggerPredicate | null; lastFiredAt?: string | null } | null;
  /** The setup's chase limit with the account's numbers already applied. */
  chaseLimitPct: number | null;
  /** The thesis's own audit rows; only ones after the fire are read. */
  updates: Array<{ type: string; timestamp: Date; fieldChanges: unknown }>;
  now: Date;
  windowDays?: number;
}): SpentBuyCrossing | null {
  const { status, direction, currentPrice, enter } = input;
  if (status !== "WATCHING") return null;
  if (direction !== "LONG" && direction !== "SHORT") return null;
  if (currentPrice == null || currentPrice <= 0) return null;
  if (!enter?.lastFiredAt) return null;

  // The predicate, not the trade direction, says where the level is and which
  // way the price has to move to have left it behind.
  const at = crossingLevel(enter.predicate);
  if (!at) return null;

  const fired = new Date(enter.lastFiredAt);
  if (Number.isNaN(fired.getTime())) return null;
  const ageDays = (input.now.getTime() - fired.getTime()) / 86_400_000;
  if (ageDays < 0 || ageDays > (input.windowDays ?? SPENT_CROSSING_WINDOW_DAYS)) return null;

  // Spent means the price is PAST the level in the direction the buy fires.
  // Back on the other side and the buy can cross again — nothing to answer.
  const pastPct =
    at.crossing === "ABOVE"
      ? ((currentPrice - at.level) / at.level) * 100
      : ((at.level - currentPrice) / at.level) * 100;
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
    level: at.level,
    crossing: at.crossing,
    firedAt: fired.toISOString().slice(0, 10),
    pastPct,
    chaseLimitPct,
    insideChase: chaseLimitPct == null || pastPct <= chaseLimitPct,
  };
}
