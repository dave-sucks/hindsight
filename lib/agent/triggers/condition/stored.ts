/**
 * Comparing stored conditions. Pure and client-safe.
 */

import { shapeOf } from "./valid";

/** The same condition however its keys are ordered. A removed condition only matches itself. */
export function samePredicate(a: unknown, b: unknown): boolean {
  const canon = (p: unknown) => JSON.stringify(sortKeys(shapeOf(p) ?? p));
  return canon(a) === canon(b);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
}
