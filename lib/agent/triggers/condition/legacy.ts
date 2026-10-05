/**
 * The translator between today's predicate kinds and the condition shape.
 * Each measure declares how it reads and writes the kinds (its `legacy`
 * field); this file only walks groups and asks the measures.
 *
 *   fromLegacy: every stored kind → a condition (or a group of them).
 *   toLegacy:   a condition → the kind that says the same thing, or null.
 *
 * Until the cutover the server stores and checks kinds, so the form builds a
 * condition and saves `toLegacy(condition)`. docs/plans/TRIGGER_TYPES.md §9.
 *
 * Pure and client-safe.
 */

import type { TriggerPredicate } from "../types";
import { MEASURES } from "./catalog";
import type { Condition, Retired, When } from "./types";
import { isGroup, isRetired } from "./types";

type Reader = (p: TriggerPredicate) => When | null;

/** The measures that read each stored kind, in catalog order (a review schedule is read by two). */
const READERS: ReadonlyMap<string, Reader[]> = (() => {
  const out = new Map<string, Reader[]>();
  for (const m of Object.values(MEASURES)) {
    for (const [kind, read] of Object.entries(m.legacy.from)) out.set(kind, [...(out.get(kind) ?? []), read as Reader]);
  }
  return out;
})();

export function fromLegacy(p: unknown): When | Retired {
  if (!p || typeof p !== "object" || typeof (p as { kind?: unknown }).kind !== "string") return { retired: true, was: p };
  const q = p as TriggerPredicate;
  if (q.kind === "AND" || q.kind === "OR") {
    const conditions = q.predicates.map(fromLegacy);
    if (conditions.some(isRetired)) return { retired: true, was: p };
    return { match: q.kind === "AND" ? "all" : "any", conditions: conditions as When[] };
  }
  for (const read of READERS.get(q.kind) ?? []) {
    const w = read(q);
    if (w) return w;
  }
  return { retired: true, was: p };
}

/** A stored predicate as the condition shape, or null for a removed kind (nothing reads one). */
export function shapeOf(p: unknown): When | null {
  const w = fromLegacy(p);
  return isRetired(w) ? null : w;
}

export function toLegacy(w: When): TriggerPredicate | null {
  if (!isGroup(w)) return MEASURES[w.watch].legacy.to(w);
  // "Any of" one measure's conditions may be one kind (several filing events).
  const first = w.conditions[0];
  if (w.match === "any" && first && !isGroup(first) && w.conditions.every((c) => !isGroup(c) && c.watch === first.watch)) {
    const folded = MEASURES[first.watch].legacy.foldAny?.(w.conditions as Condition[]);
    if (folded) return folded;
  }
  const parts = w.conditions.map(toLegacy);
  if (parts.some((part) => part == null)) return null;
  return { kind: w.match === "all" ? "AND" : "OR", predicates: parts as TriggerPredicate[] };
}
