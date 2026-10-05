/**
 * The cascade slot: which triggers say the same thing at different values.
 *
 * One trigger per slot: a stock's own rule beats its analyst's, which beats
 * the account's. The slot is the measure, its button, its variable and the
 * settings its entry marks as identity (the RSI's length), never the typed
 * value, so "$248" and "$256" are the same floor. It gives the same classes
 * as the kinds' bucket did (frozen in ./__fixtures__/kind-rules.ts), which
 * condition.test.ts proves over every stored trigger under every action.
 * The text is a comparison key: nothing stores it or shows it, so only the
 * classes are held fixed. docs/plans/TRIGGER_TYPES.md §6.
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
  // "Any of" one measure's conditions can be one rule its entry names (a filing rule with a tier).
  const cs = w.conditions.filter((c): c is Condition => !isGroup(c));
  const one = w.match === "any" && cs.length > 0 && cs.length === w.conditions.length && cs.every((c) => c.watch === cs[0].watch);
  const taken = one ? measureOf(cs[0]).groupSlot?.(cs) : undefined;
  return taken ? conditionSlot(taken) : `${w.match}:${w.conditions.map(whenSlot).sort().join("|")}`;
}

/** `(slot, action)`. */
export function triggerSlot(w: When, action: TriggerAction): string {
  if (action === "ENTER" && !isGroup(w) && measureOf(w).level?.(w)) return `${w.watch}:enter::ENTER`;
  return `${whenSlot(w)}::${action}`;
}
