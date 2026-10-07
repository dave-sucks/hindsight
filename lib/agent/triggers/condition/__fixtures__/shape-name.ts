/**
 * A condition's name in tests, from its own fields: "price:below",
 * "move:below:peak", "repeat", "all". Tests assert on what a trigger is,
 * not on a spelling.
 */
import { conditionsOf, isGroup, shapeOf } from "..";

export function shapeName(p: unknown): string | undefined {
  const w = shapeOf(p);
  if (!w) return undefined;
  if (isGroup(w)) return w.match;
  return [w.watch, w.is, w.variable].filter(Boolean).join(":");
}

/** A rule made only of filing conditions: one event or several. */
export function isFilingRule(p: unknown): boolean {
  const w = shapeOf(p);
  return w != null && conditionsOf(w).every((c) => c.watch === "filing");
}
