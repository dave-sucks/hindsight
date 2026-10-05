/**
 * The cascade slot: which triggers say the same thing at different values.
 *
 * One trigger per slot: a stock's own rule beats its analyst's, which beats
 * the account's. The slot is the measure, its button, its variable and the
 * settings its entry marks as identity (the RSI's length), never the typed
 * value, so "$248" and "$256" are the same floor. It gives the same classes
 * as today's `triggerBucket` (../bucket), which condition.test.ts proves
 * over every stored trigger. docs/plans/TRIGGER_TYPES.md §6.
 *
 * Pure and client-safe.
 */

import type { TriggerAction } from "../types";
import { measureOf, settingDefs, settingOf } from "./catalog";
import type { Condition, When } from "./types";
import { isGroup } from "./types";
import { variableDef } from "./variables";

export function conditionSlot(c: Condition): string {
  const variable = c.variable ? (variableDef(c.variable).slot ?? c.variable) : undefined;
  const identity = settingDefs(c)
    .filter((s) => s.identity)
    .map((s) => `${s.key}=${String(settingOf(c, s.key))}`);
  return [c.watch, c.is, variable, ...identity].filter((x) => x != null).join(":");
}

export function whenSlot(w: When): string {
  if (!isGroup(w)) return conditionSlot(w);
  return `${w.match}:${w.conditions.map(whenSlot).sort().join("|")}`;
}

/** `(slot, action)`. */
export function triggerSlot(w: When, action: TriggerAction): string {
  if (action === "ENTER" && !isGroup(w) && measureOf(w).oneEnter?.(w)) return `${w.watch}:enter::ENTER`;
  return `${whenSlot(w)}::${action}`;
}
