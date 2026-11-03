/**
 * The weekly floor on a state review (DAV-329) — in a file with no server
 * imports, so the evaluator and the Triggers tab read the SAME number. The
 * tab used to print the stored `cooldownDays`; with a floor in force that
 * would say "once a day" on a rule that asks once a week.
 */

import { shapeOf } from "./condition/valid";
import { isState } from "./condition/rules";
import type { FireMode } from "./fire-mode";


/**
 * Predicates that describe a STATE rather than a moment.
 *
 * "Below the 200-day" is not something that happens — it is somewhere the
 * stock IS, for weeks at a time. A price line is crossed in an instant and
 * is worth re-asking daily while it is breached; a state that has held for
 * a fortnight is not news on its fourteenth morning.
 *
 * A composite counts only when every child does, so a state ANDed with a
 * price line keeps the faster clock.
 */
export function isStatePredicate(p: unknown): boolean {
  // Each measure says whether it is a state (./condition/measures).
  const w = shapeOf(p);
  return w != null && isState(w);
}

/** A state rung that is a review asks once a week, not once a day. */
export const STATE_PREDICATE_MIN_COOLDOWN_DAYS = 7;

/**
 * The floor, applied to whatever cooldown the rung would otherwise use.
 * A review on a state is floored at a week. A trade (a buy, add, trim or
 * sale) is floored at a day whatever its fire mode: a sale is a standing
 * order that asks every day its condition holds, and never more often.
 */
export function flooredCooldownDays(
  trigger: { action: string; predicate: unknown; fireMode?: FireMode },
  days: number,
): number {
  if (trigger.action === "REVIEW" && isStatePredicate(trigger.predicate)) return Math.max(days, STATE_PREDICATE_MIN_COOLDOWN_DAYS);
  // A trade asks once a day, never more. A wait of 0 on a sale woke a run
  // every pass while the analyst held (CEG, 2026-11-02: 9:30, 9:35, 9:40);
  // the "a waiting sale drops the repeats" guard has nothing to hold onto
  // when the run holds.
  if (trigger.action !== "REVIEW") return Math.max(days, 1);
  return days;
}
