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
import type { Line, LineContext, Source } from "./measure";
import type { Condition, When } from "./types";
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

/** A typed price level as its number and side, and whether it waits for the close; null for anything else. */
export function levelOf(w: When): { value: number; above: boolean; close: boolean } | null {
  if (!isLevel(w)) return null;
  const c = w as Condition;
  if (c.value == null || (c.is !== "above" && c.is !== "below")) return null;
  return { value: c.value, above: c.is === "above", close: c.settings?.close === true };
}

/** Where it sits on the chart (a typed level, a % from our position), or null. */
export function lineOf(w: When, ctx: LineContext): Line | null {
  return isGroup(w) ? null : (measureOf(w).line?.(w, ctx) ?? null);
}

/** One condition measured from our position (our entry, the high since we bought): inert until we own the stock. */
export function fromPosition(w: When): boolean {
  return !isGroup(w) && w.variable != null && variableDef(w.variable).position === true;
}

/** The review clock's days (counted from the last review), or null when it isn't the clock. */
export function reviewClockDays(w: When): number | null {
  return !isGroup(w) && measureOf(w).clock === true && w.value != null ? w.value : null;
}

/** Read off the quote, the position and the daily snapshot alone: no earnings calendar, no filings, no schedule. A group only when every condition is. */
export function readsTheTape(w: When): boolean {
  return conditionsOf(w).every((c) => measureOf(c).timed !== true && !readsSource(c, "earnings") && !readsSource(c, "filings"));
}

/** How soon a protective sale fires, lower first: a typed floor nearer the price, a smaller %. Null when it has no number. */
export function tightness(w: When, isLong: boolean): number | null {
  if (isGroup(w) || w.value == null) return null;
  const level = levelOf(w);
  if (level) return level.above === isLong ? level.value : -level.value;
  return w.value;
}

/**
 * Does `next` protect less than `prev`, the same rule at a new value? A typed
 * line moved away from the price, a bigger %, or a setting that loosens
 * raised or turned on (waiting for the close, arming later, a wider range).
 */
export function loosens(prev: When, next: When): boolean {
  if (isGroup(prev) || isGroup(next)) return false;
  if (prev.watch !== next.watch || prev.is !== next.is || prev.variable !== next.variable) return false;
  const level = levelOf(prev);
  const a = prev.value ?? 0;
  const b = next.value ?? 0;
  if (level ? (level.above ? b > a : b < a) : b > a) return true;
  const n = (v: unknown) => (typeof v === "number" ? v : v === true ? 1 : 0);
  return settingDefs(next).some((s) => s.looser === true && n(next.settings?.[s.key]) > n(prev.settings?.[s.key]));
}

/** A review schedule's days (every N days, or N days from the buy or the event date), or null. */
export function scheduleDays(w: When | null): number | null {
  return w != null && !isGroup(w) && measureOf(w).timed === true && w.value != null ? w.value : null;
}

/** A protective line: a typed price, or a % from our position (a floor, a trail, a gain or drawdown off our entry). */
export function isProtectiveLine(w: When): boolean {
  return isLevel(w) || fromPosition(w);
}

/** It carries a number a person adjusts: a price, a %, a count. Not one that may be zero or negative (a beat by any amount, strength vs. the S&P). */
export function carriesNumber(w: When): boolean {
  return conditionsOf(w).some((c) => {
    const value = measureOf(c).value;
    return c.value != null && value.allowNegative !== true && value.zero == null;
  });
}
