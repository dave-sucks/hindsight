/**
 * The translator between today's predicate kinds and the condition shape.
 * Each measure declares how it reads and writes the kinds (its `legacy`
 * field); this file only walks groups and asks the measures.
 *
 *   fromLegacy: every stored kind → a condition (or a group of them); a
 *               predicate already in the shape comes back as it is.
 *   toLegacy:   a condition → the kind that says the same thing, or null.
 *
 * Since the cutover the app stores and checks the shape. The translator reads
 * rows stored before it (and an old kind a model still sends), and the save
 * check spells a condition as a kind to run the old schema on it, until PR 4
 * moves that check onto the catalog and deletes this file. docs/plans/TRIGGER_TYPES.md §9.
 *
 * Pure and client-safe.
 */


import { MEASURES } from "./catalog";
import type { Condition, Retired, When } from "./types";
import { isGroup, isRetired } from "./types";
import type { LegacyPredicate } from "./legacy-types";

type Reader = (p: LegacyPredicate) => When | null;

/** The measures that read each stored kind, in catalog order (a review schedule is read by two). */
const READERS: ReadonlyMap<string, Reader[]> = (() => {
  const out = new Map<string, Reader[]>();
  for (const m of Object.values(MEASURES)) {
    for (const [kind, read] of Object.entries(m.legacy.from)) out.set(kind, [...(out.get(kind) ?? []), read as Reader]);
  }
  return out;
})();

/** A predicate already in the condition shape: a known measure, or a group of them. */
export function isShape(p: unknown): p is When {
  if (!p || typeof p !== "object") return false;
  const { watch, match, conditions } = p as { watch?: unknown; match?: unknown; conditions?: unknown };
  if (typeof watch === "string") return Object.hasOwn(MEASURES, watch);
  return (match === "all" || match === "any") && Array.isArray(conditions) && conditions.length > 0 && conditions.every(isShape);
}

export function fromLegacy(p: unknown): When | Retired {
  // Stored since the cutover: already the shape, read as it is.
  if (isShape(p)) return p;
  if (!p || typeof p !== "object" || typeof (p as { kind?: unknown }).kind !== "string") return { retired: true, was: p };
  const q = p as LegacyPredicate;
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

export function toLegacy(w: When): LegacyPredicate | null {
  if (!isGroup(w)) return MEASURES[w.watch].legacy.to(w);
  // "Any of" one measure's conditions may be one kind (several filing events).
  const first = w.conditions[0];
  if (w.match === "any" && first && !isGroup(first) && w.conditions.every((c) => !isGroup(c) && c.watch === first.watch)) {
    const folded = MEASURES[first.watch].legacy.foldAny?.(w.conditions as Condition[]);
    if (folded) return folded;
  }
  const parts = w.conditions.map(toLegacy);
  if (parts.some((part) => part == null)) return null;
  return { kind: w.match === "all" ? "AND" : "OR", predicates: parts as LegacyPredicate[] };
}
