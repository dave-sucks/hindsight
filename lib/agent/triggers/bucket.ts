/**
 * The merge/precedence bucket for a trigger — `(predicateKey, action)`.
 *
 * Two triggers in the same bucket express the same intent, so exactly one
 * survives:
 *   - within one level: `mergeTriggers` keeps the agent-supplied rung over
 *     the horizon default (lib/agent/triggers/defaults).
 *   - across levels: `resolveLadder` keeps the most-specific level's rung
 *     (lib/agent/triggers/levels) — thesis beats analyst beats account.
 *
 * Extracted from `defaults.ts` on 2026-08-05 so the cascade resolver and
 * the client-side trigger UI can share it: `defaults.ts` imports
 * `node:crypto`, which breaks the client bundle. This module is pure —
 * no node builtins, no side effects — so it is safe to import anywhere.
 * `defaults.ts` re-exports `triggerBucket` so existing import paths keep
 * working.
 */

import type { TriggerAction, TriggerPredicate } from "./types";
import { fromLegacy } from "./condition/legacy";
import { triggerSlot, whenSlot } from "./condition/slot";
import { isRetired } from "./condition/types";

/**
 * Stable identity for a predicate, ignoring its VALUE: "price below $60" and
 * "price below $71" are the same rung at different levels. Read off the
 * condition shape's slot (./condition/slot), the same classes the kinds gave.
 */
export function predicateKey(p: TriggerPredicate): string {
  const w = fromLegacy(p);
  return isRetired(w) ? `retired:${JSON.stringify(p)}` : whenSlot(w);
}

/**
 * `(predicateKey, action)`. Exported for "is a same-bucket rung already
 * present?" checks that must not go through mergeTriggers' within-list
 * dedup (the level write path, the horizon filter, the ratchet). A buy on a
 * typed price is one rung whichever way it's set: the price you'd start at.
 *
 * Takes the structural minimum rather than a full `Trigger` so callers
 * holding a loosely-typed client-side rung can use it without a cast.
 */
export function triggerBucket(t: { predicate: TriggerPredicate; action: TriggerAction }): string {
  const w = fromLegacy(t.predicate);
  return isRetired(w) ? `retired:${JSON.stringify(t.predicate)}::${t.action}` : triggerSlot(w, t.action);
}
