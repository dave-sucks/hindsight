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
import { isShape } from "./legacy";

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
