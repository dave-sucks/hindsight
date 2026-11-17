/**
 * The cascade slot: which triggers say the same thing at different values.
 *
 * One trigger per slot: a stock's own rule beats its analyst's, which beats
 * the account's. The slot is the measure, its button, its variable and the
 * settings its entry marks as identity (the RSI's length), never the typed
 * value, so "$248" and "$256" are the same floor. It gives the same classes
 * the kinds' bucket did. The text is a comparison key: nothing stores it or
 * shows it, so only the classes are held fixed. docs/plans/TRIGGER_TYPES.md §6.
 *
 * `triggerSlot` is the one name for it: the merge within a level
 * (`mergeTriggers`), the cascade across levels (`resolveLadder`), and every
 * "is that rule already here?" check read it.
 *
 * Pure and client-safe.
 */

import type { TriggerAction } from "../types";
import { measureOf, settingDefs, settingOf } from "./catalog";
import type { Condition, When } from "./types";
import { isGroup } from "./types";
import { shapeOf } from "./valid";
import { variableDef } from "./variables";

export function conditionSlot(c: Condition): string {
  const variable = c.variable ? (variableDef(c.variable).slot ?? c.variable) : undefined;
  const identity = settingDefs(c)
    .filter((s) => s.identity)
    .map((s) => `${s.key}=${String(settingOf(c, s.key))}`);
  return [c.watch, c.is, variable, ...identity].filter((x) => x != null).join(":");
}

export function whenSlot(w: When): string {
  return isGroup(w) ? `all:${w.conditions.map(conditionSlot).sort().join("|")}` : conditionSlot(w);
}

/**
 * `(slot, action)` for a trigger. A buy on a typed price is one slot whichever
 * way it's set: the price you'd start at. A removed condition is its own slot.
 * Takes the structural minimum so a loosely typed client-side rule can use it.
 */
export function triggerSlot(t: { predicate: unknown; action: TriggerAction }): string {
  const w = shapeOf(t.predicate);
  if (!w) return `retired:${JSON.stringify(t.predicate)}::${t.action}`;
  if (t.action === "ENTER" && !isGroup(w) && measureOf(w).level?.(w)) return `${w.watch}:enter::ENTER`;
  return `${whenSlot(w)}::${t.action}`;
}
