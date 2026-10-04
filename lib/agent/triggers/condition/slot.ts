/**
 * The cascade slot: which triggers say the same thing at different values.
 *
 * One trigger per slot: a stock's own rule beats its analyst's, which beats
 * the account's. The slot is watch + button + variable (+ the params that
 * change what is watched), never the typed value, so "$248" and "$256" are
 * the same floor. It gives the same classes as today's `triggerBucket`
 * (./bucket), which slot.test.ts proves over every stored trigger.
 * docs/plans/TRIGGER_TYPES.md §6.
 *
 * Pure and client-safe.
 */

import type { TriggerAction } from "../types";
import type { Condition, When } from "./types";
import { isGroup } from "./types";

export function conditionSlot(c: Condition): string {
  const p = c.params ?? {};
  switch (c.watch) {
    case "price":
      if (c.unit !== "%") return `price:${c.is}:${c.variable ?? "fixed"}`;
      return `price%:${c.is}:${c.variable ?? "none"}`;
    case "rsi":
      return `rsi:${p.period ?? 14}:${c.is}`;
    case "strength":
      return `strength:${p.window ?? "3M"}:${c.is}`;
    case "volume":
      return `volume:${c.is}`;
    case "gap":
      return "gap";
    case "insiders":
      return "insiders";
    case "surprise":
      return `surprise:${c.is}`;
    case "report":
      return `report:${c.is}`;
    case "filing":
      // A material rule and a red-flag rule override each other; a rule
      // naming one event adds to them and never silences them.
      return c.variable && !c.variable.startsWith("tier:") ? `filing:${c.variable}` : "filing:tier";
    case "schedule":
      if (c.is === "every") return "schedule:every";
      return c.variable === "event" ? `schedule:event:${c.is}` : `schedule:${c.variable ?? "none"}`;
  }
}

export function whenSlot(w: When): string {
  if (!isGroup(w)) return conditionSlot(w);
  return `${w.match}:${w.conditions.map(whenSlot).sort().join("|")}`;
}

/** `(slot, action)`. A fixed-price buy above and below are one slot: the price you'd start the position at. */
export function triggerSlot(w: When, action: TriggerAction): string {
  if (action === "ENTER" && !isGroup(w) && w.watch === "price" && w.unit !== "%" && !w.variable) {
    return "price:fixed::ENTER";
  }
  return `${whenSlot(w)}::${action}`;
}
