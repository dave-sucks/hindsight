/**
 * What the save accepts: a condition in the shape that its measure can
 * check, every number in range. The catalog decides (`fits`, `problem`,
 * `problemAny` on each entry), and a refusal is the measure's own sentence
 * naming the number; nothing here knows a measure.
 *
 * Pure and client-safe.
 */

import { MEASURES, STOCK_MEASURES } from "./catalog";
import { conditionRefusal } from "./range";
import type { Condition, When } from "./types";
import { isGroup } from "./types";

/** A known measure's condition. */
function isCondition(p: unknown): p is Condition {
  const watch = p && typeof p === "object" ? (p as { watch?: unknown }).watch : undefined;
  return typeof watch === "string" && Object.hasOwn(MEASURES, watch);
}

/** A predicate in the condition shape: a known measure, or "all" of them (one level). Nothing else is read. */
export function isShape(p: unknown): p is When {
  if (isCondition(p)) return true;
  if (!p || typeof p !== "object") return false;
  const { match, conditions } = p as { match?: unknown; conditions?: unknown };
  return match === "all" && Array.isArray(conditions) && conditions.length > 0 && conditions.every(isCondition);
}

/** A stored predicate as the condition shape, or null for anything else: a removed condition, which nothing checks. */
export function shapeOf(p: unknown): When | null {
  return isShape(p) ? p : null;
}

/** A condition, or a group of up to 8, that its measures can check with every number in range. */
export function whenValid(w: unknown): w is When {
  return refusalOf(w) === null;
}

/** Why the save refuses a condition, in its measure's words with the number, or null when it doesn't. */
export function refusalOf(w: unknown): string | null {
  if (!isShape(w)) return notACondition(w);
  if (!isGroup(w)) return conditionRefusal(w);
  const cs = w.conditions;
  if (cs.length < 1 || cs.length > 8) return `A trigger takes 1 to 8 conditions; this has ${cs.length}.`;
  for (const c of cs) {
    const p = refusalOf(c);
    if (p) return p;
  }
  return null;
}

/**
 * What a refusal says when the input isn't a condition at all, an old kind
 * included: the measures it can be.
 */
export function notACondition(w: unknown): string {
  const measures = STOCK_MEASURES.map((m) => m.id).join(", ");
  const kind = w && typeof w === "object" && typeof (w as { kind?: unknown }).kind === "string" ? (w as { kind: string }).kind : null;
  const lead = kind ? `"kind: ${kind}" is an old trigger kind, retired. ` : "Not a condition this app can check. ";
  return `${lead}A condition is { watch, is, value, variable, settings } with watch one of: ${measures}; or { match: "all", conditions } for two or more that must all hold. "Either one" is two triggers.`;
}
