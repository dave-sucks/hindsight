/**
 * What is stored, and what the app reads, while both shapes exist.
 *
 * Storage holds the condition shape: every write turns a trigger's predicate
 * into it (`toStoredTriggers`). Until the agents' tools and prompts move to the
 * shape, the code that speaks in kinds (the sentences agents read, the edit
 * ops they send) reads the kinds' spelling of it (`viewTriggers`). Both are
 * applied once, in the database client (lib/prisma.ts), so no write can store
 * a kind and no read can miss the view. A removed kind (REVIEW_DATE_HIT) is
 * kept verbatim either way. docs/plans/TRIGGER_TYPES.md §9.
 *
 * Pure and client-safe.
 */

import { isShape, shapeOf, toLegacy } from "./legacy";

/** The predicate as stored: the condition shape (a removed kind verbatim). */
export function toStoredPredicate(p: unknown): unknown {
  return shapeOf(p) ?? p;
}

/** The predicate as the code that speaks in kinds reads it: the kind that says the same thing (or the shape, when no kind can). */
export function viewPredicate(p: unknown): unknown {
  if (!isShape(p)) return p;
  return toLegacy(p) ?? p;
}

/** A stored trigger list with every predicate in the condition shape. Anything that isn't a list is left alone. */
export function toStoredTriggers(json: unknown): unknown {
  return mapPredicates(json, toStoredPredicate);
}

/** A stored trigger list as the code that speaks in kinds reads it. */
export function viewTriggers(json: unknown): unknown {
  return mapPredicates(json, viewPredicate);
}

/** The same condition, however it is spelled (a kind or the shape, keys in any order, explicit defaults or not). */
export function samePredicate(a: unknown, b: unknown): boolean {
  const canon = (p: unknown) => JSON.stringify(sortKeys(shapeOf(p) ?? p));
  return canon(a) === canon(b);
}

function mapPredicates(json: unknown, f: (p: unknown) => unknown): unknown {
  if (!Array.isArray(json)) return json;
  return json.map((t) => (t && typeof t === "object" && "predicate" in t ? { ...t, predicate: f((t as { predicate: unknown }).predicate) } : t));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
}
