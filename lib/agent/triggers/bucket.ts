/**
 * The merge/precedence bucket for a trigger — `(predicateKey, action)`.
 *
 * Two triggers in the same bucket express the same intent, so exactly one
 * survives:
 *   - within one level: `mergeTriggers` keeps the agent-supplied rung over
 *     the horizon default (lib/agent/triggers/defaults).
 *   - across levels: `resolveLadder` keeps the most-specific level's rung
 *     (lib/agent/triggers/levels) — thesis beats analyst beats account
 *     beats code default.
 *
 * Extracted from `defaults.ts` on 2026-08-05 so the cascade resolver and
 * the client-side trigger UI can share it: `defaults.ts` imports
 * `node:crypto`, which breaks the client bundle. This module is pure —
 * no node builtins, no side effects — so it is safe to import anywhere.
 * `defaults.ts` re-exports `triggerBucket` so existing import paths keep
 * working.
 */

import type { TriggerAction, TriggerPredicate } from "./types";

/**
 * Stable identity for a predicate, ignoring its VALUE. "Price below $60"
 * and "price below $71" are the same rung at different levels — that's
 * what makes an override an override rather than a second stop.
 *
 * AND/OR composites use a structural fingerprint so an agent's custom
 * "OR(FILING 8-K, FILING 10-Q)" doesn't get duplicated by the catalyst
 * default's similar OR — same intent, same key.
 */
export function predicateKey(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return p.kind;
    case "PRICE_MOVE_PCT":
      return `${p.kind}:${p.window}:${p.direction}`;
    case "GAIN_FROM_ENTRY":
      return `${p.kind}:${p.direction}`;
    case "TRAILING_FROM_HIGH":
      return p.kind;
    case "VS_SMA":
      return `${p.kind}:${p.period}:${p.direction}`;
    case "RSI":
      return `${p.kind}:${p.direction}`;
    case "SIGNAL_TYPE":
      return `${p.kind}:${p.signalType}:${p.sentiment ?? ""}`;
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
      return p.kind;
    case "GUIDANCE_CHANGE":
      return `${p.kind}:${p.direction}`;
    case "FILING":
      return `${p.kind}:${p.formType}`;
    case "TIME_ELAPSED":
      return p.kind;
    case "REVIEW_DATE_HIT":
      return p.kind;
    case "AND":
    case "OR":
      return `${p.kind}:${p.predicates.map(predicateKey).sort().join("|")}`;
  }
}

/**
 * `(predicateKey, action)`. Exported for
 * scripts/convert-static-floors-to-trails.ts, which needs "is a same-bucket
 * rung already present?" WITHOUT mergeTriggers' within-list dedup (the
 * hand-written ladders must be preserved verbatim, duplicates and all).
 *
 * Takes the structural minimum rather than a full `Trigger` so callers
 * holding a loosely-typed client-side rung can use it without a cast.
 */
export function triggerBucket(t: {
  predicate: TriggerPredicate;
  action: TriggerAction;
}): string {
  // An ENTER rung on an absolute price level is ONE intent — "the price
  // at which I'd start this position" — whether it's expressed as a
  // breakout (PRICE_ABOVE) or a dip (PRICE_BELOW). Collapsing the two
  // into a single bucket is what makes the analyst's entry mode an
  // override rather than an addition: without it, flipping a seat to
  // buy-the-dip leaves the old PRICE_ABOVE rung in place and the thesis
  // carries two contradictory ENTERs, one of which can never be right.
  // Flagged in docs/plans/ENTRY_TRIGGER_SEMANTICS.md → "Don't break".
  if (
    t.action === "ENTER" &&
    (t.predicate.kind === "PRICE_ABOVE" || t.predicate.kind === "PRICE_BELOW")
  ) {
    return "PRICE_LEVEL::ENTER";
  }
  return `${predicateKey(t.predicate)}::${t.action}`;
}
