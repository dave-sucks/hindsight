/**
 * The weekly floor on a state review (DAV-329) — in a file with no server
 * imports, so the evaluator and the Triggers tab read the SAME number. The
 * tab used to print the stored `cooldownDays`; with a floor in force that
 * would say "once a day" on a rule that asks once a week.
 */

/** Loose on purpose: the evaluator's strict predicate and the sheet's wire type both fit. */
type PredicateLike = { kind: string; predicates?: readonly PredicateLike[] };

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
export function isStatePredicate(p: PredicateLike): boolean {
  switch (p.kind) {
    case "VS_SMA":
    case "PCT_FROM_52W_HIGH":
    case "RS_VS_SPY":
      return true;
    case "AND":
    case "OR": {
      const children = p.predicates ?? [];
      return children.length > 0 && children.every(isStatePredicate);
    }
    default:
      return false;
  }
}

/** A state rung that is a review asks once a week, not once a day. */
export const STATE_PREDICATE_MIN_COOLDOWN_DAYS = 7;

/**
 * The floor, applied to whatever cooldown the rung would otherwise use.
 * Only a REVIEW is floored: a buy on these fires on its crossing, and a
 * sale is a standing order that asks every day its condition holds.
 */
export function flooredCooldownDays(
  trigger: { action: string; predicate: PredicateLike },
  days: number,
): number {
  return trigger.action === "REVIEW" && isStatePredicate(trigger.predicate)
    ? Math.max(days, STATE_PREDICATE_MIN_COOLDOWN_DAYS)
    : days;
}
