/**
 * The trigger rules every measure answers on its catalog entry, combined for
 * a whole condition or group: the default cooldown, the weekly floor on a
 * state review, whether a sale can go straight to a proposal and the label
 * it closes with, the close-only reading of a watched stock's floor, and what
 * the trigger check loads for it.
 * docs/plans/TRIGGER_TYPES.md §6.1.
 *
 * Pure and client-safe.
 */

import { measureOf, settingDefs } from "./catalog";
import type { Source } from "./measure";
import type { When } from "./types";
import { conditionsOf, isGroup } from "./types";
import { variableDef } from "./variables";

/**
 * Days between fires when the trigger names none. A group of one measure's
 * conditions (a rule naming several filings) is one rule and keeps its
 * measure's; a mix takes its slowest condition's, at least a day.
 */
export function defaultCooldownDays(w: When, action: string): number {
  if (!isGroup(w)) return measureOf(w).cooldownDays(w, action);
  const days = w.conditions.map((x) => defaultCooldownDays(x, action));
  const first = w.conditions[0];
  const oneMeasure = first != null && !isGroup(first) && w.conditions.every((x) => !isGroup(x) && x.watch === first.watch);
  return oneMeasure ? Math.max(...days) : Math.max(1, ...days);
}

/** A state, not a moment ("below the 200-day"). A group is one only when every condition is. */
export function isState(w: When): boolean {
  if (isGroup(w)) return w.conditions.length > 0 && w.conditions.every(isState);
  return measureOf(w).state?.(w) === true;
}

/** A sale with nothing for an analyst to judge: a typed price, or a % from a close, our entry or the high. */
export function isDirectEligible(w: When): boolean {
  return !isGroup(w) && measureOf(w).direct?.(w) === true;
}

/** The label a protective sale closes with, or null for a judgment sale the agent labels itself. */
export function protectiveCloseReason(w: When, direction: string | null): "STOP" | "TARGET" | null {
  if (isGroup(w) || !isDirectEligible(w)) return null;
  return measureOf(w).closeReason?.(w, direction !== "SHORT") ?? "STOP";
}

/** A typed price level (a floor or a target), not a group. */
export function isLevel(w: When): boolean {
  return !isGroup(w) && measureOf(w).level?.(w) === true;
}

/** Every typed price level in the condition read on the close (a watched stock's floor). Same object when nothing changes. */
export function onTheClose(w: When): When {
  if (isGroup(w)) {
    const conditions = w.conditions.map(onTheClose);
    return conditions.every((c, i) => c === w.conditions[i]) ? w : { ...w, conditions };
  }
  if (!isLevel(w) || w.settings?.close === true) return w;
  return { ...w, settings: { ...w.settings, close: true } };
}

/** Whether the trigger check must load `source` for it: its measure reads it, or (the snapshot) a variable or setting it uses does. */
export function readsSource(w: When, source: Source): boolean {
  return conditionsOf(w).some(
    (c) =>
      measureOf(c).reads?.includes(source) === true ||
      (source === "snapshot" &&
        ((c.variable != null && variableDef(c.variable).snapshot === true) ||
          settingDefs(c).some((s) => s.snapshot === true && c.settings?.[s.key] != null))),
  );
}

/** Waits for the day's close: it is checked on the close pass. */
export function waitsForClose(w: When): boolean {
  return conditionsOf(w).some((c) => c.settings?.close === true);
}
