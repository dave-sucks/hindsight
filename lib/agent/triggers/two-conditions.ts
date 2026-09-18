/**
 * two-conditions.ts — what a hand-built two-condition trigger may be
 * (DAV-281). The evaluator and the agents already handle AND / OR of any
 * shape; this is only the rule for what the Add Trigger dialog may post, so
 * the thesis path and the account / analyst path say the same thing.
 */

import type { TriggerPredicate } from "./types";

type Kind = TriggerPredicate["kind"];

/**
 * Null when `p` is a plain condition the caller allows, or a pair of them.
 * Otherwise the sentence to show the person.
 */
export function addablePredicateProblem(p: TriggerPredicate, allowed: (kind: Kind) => boolean): string | null {
  if (p.kind !== "AND" && p.kind !== "OR") {
    return allowed(p.kind) ? null : `That trigger kind can't be added here (got ${p.kind}).`;
  }
  if (p.predicates.length !== 2) return "A trigger built by hand takes two conditions.";
  for (const c of p.predicates) {
    if (c.kind === "AND" || c.kind === "OR") return "A condition can't itself be two conditions.";
    // A day count is a schedule. "Every 7 days AND down 3%" has no meaning
    // the evaluator could honour: the clock restarts on every review.
    if (c.kind === "REVIEW_CADENCE") return "A day count is a schedule, not a condition — add it as its own trigger.";
    if (!allowed(c.kind)) return `That condition can't be added here (got ${c.kind}).`;
  }
  return null;
}

/** Every plain condition in a predicate (itself, or a pair's two). */
export function plainConditions(p: TriggerPredicate): TriggerPredicate[] {
  return p.kind === "AND" || p.kind === "OR" ? p.predicates.flatMap(plainConditions) : [p];
}
