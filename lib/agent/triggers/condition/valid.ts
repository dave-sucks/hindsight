/**
 * What the save accepts: a condition in the shape that its measure can
 * check, every number in range. The catalog decides (`fits`, `valid`,
 * `validAny` on each entry); nothing here knows a measure.
 *
 * Pure and client-safe.
 */

import { MEASURES } from "./catalog";
import type { Condition, When } from "./types";
import { isGroup } from "./types";

/** A predicate in the condition shape: a known measure, or a group of them. Nothing else is read. */
export function isShape(p: unknown): p is When {
  if (!p || typeof p !== "object") return false;
  const { watch, match, conditions } = p as { watch?: unknown; match?: unknown; conditions?: unknown };
  if (typeof watch === "string") return Object.hasOwn(MEASURES, watch);
  return (match === "all" || match === "any") && Array.isArray(conditions) && conditions.length > 0 && conditions.every(isShape);
}

/** A stored predicate as the condition shape, or null for anything else: a removed condition, which nothing checks. */
export function shapeOf(p: unknown): When | null {
  return isShape(p) ? p : null;
}

/** A condition, or a group of up to 8, that its measures can check with every number in range. */
export function whenValid(w: unknown): w is When {
  if (!isShape(w)) return false;
  if (!isGroup(w)) return MEASURES[w.watch].valid(w);
  const cs = w.conditions;
  const first = cs[0];
  // "Any of" one measure's conditions may be one rule (several filing events).
  if (w.match === "any" && first && !isGroup(first) && cs.every((c) => !isGroup(c) && c.watch === first.watch)) {
    const one = MEASURES[first.watch].validAny?.(cs as Condition[]);
    if (one !== undefined) return one;
  }
  return cs.length >= 1 && cs.length <= 8 && cs.every(whenValid);
}
