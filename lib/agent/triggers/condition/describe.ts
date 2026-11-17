/**
 * The words. A condition reads as its form's two halves: the direction (the
 * button's label, or the measure's one word) and the value (what the input
 * holds, what it is measured from, and any setting that isn't the default):
 *
 *   below · $868        below · 15% from the high        every · 30 days
 *
 * The pill, the popover and the dialog all say it this way; there is no
 * second vocabulary to keep in step. docs/plans/TRIGGER_TYPES.md §6.
 *
 * Pure and client-safe.
 */

import { measureOf, settingDefs } from "./catalog";
import type { PillPart } from "./measure";
import type { Condition, When } from "./types";
import { conditionsOf, isGroup } from "./types";
import { shapeOf } from "./valid";
import { levelOf } from "./rules";
import { variableDef } from "./variables";
import { money } from "./words";

export { money } from "./words";

const ACTION_LABEL: Readonly<Record<string, string>> = { ENTER: "Buy if", ADD: "Add if", TRIM: "Trim if", EXIT: "Sell if", STOP_WATCHING: "Stop watching if" };

/** "Sell if", "Stop watching if", "Review if": the action's own words, whatever the stock's state. */
export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? "Review if";
}

/** The word before a row of pills: a trim's pill starts "N% if" itself, so its row says "Trim". */
export function rowLabel(action: string): string {
  return action === "TRIM" ? "Trim" : actionLabel(action);
}

/** The share of the position a trim sells when it names none: half. */
export const DEFAULT_TRIM_PCT = 50;

/** A trim's size, in every On fire mode. */
export function trimPctOf(t: { trimPct?: number | null }): number {
  return t.trimPct ?? DEFAULT_TRIM_PCT;
}

/**
 * Fired, and no market close has found its condition false since: it does
 * not fire again until one does (the 16:20 ET pass stamps `falseAtCloseAt`).
 * One that never fired, or whose condition or action changed since it fired
 * (the change clears `lastFiredAt`), is not.
 */
export function firedSinceFalseClose(t: { lastFiredAt?: string | null; falseAtCloseAt?: string | null }): boolean {
  if (t.lastFiredAt == null) return false;
  return t.falseAtCloseAt == null || new Date(t.falseAtCloseAt).getTime() <= new Date(t.lastFiredAt).getTime();
}

/** When a fired trigger can fire again, in words: "after a close back above $150". */
export function firesAgainWords(t: { predicate: unknown }): string {
  const w = shapeOf(t.predicate);
  const level = w ? levelOf(w) : null;
  return level ? `after a close back ${level.above ? "below" : "above"} ${money(level.value)}` : "after a close where it no longer holds";
}

/** The action as a trigger says it; a trim names its size: "Trim 30% if". */
export function triggerLabel(t: { action: string; trimPct?: number | null }): string {
  return t.action === "TRIM" ? `Trim ${trimPctOf(t)}% if` : actionLabel(t.action);
}

/** The two halves: "below" and "$868". */
export function conditionParts(c: Condition): PillPart {
  const m = measureOf(c);
  const label = (m.buttons?.find((b) => b.is === c.is)?.label ?? m.word ?? "").toLowerCase();
  return { label, value: valueText(c) };
}

/** The value half. `say` is "chip" on the pill and "words" in a sentence (the variable's own words). */
function valueText(c: Condition, say: "chip" | "words" = "chip"): string {
  const m = measureOf(c);
  const v = m.value;
  const vars = m.variables;
  const chip = c.variable ? variableDef(c.variable)[say] : undefined;
  let text: string;
  if (vars?.mode === "replace" && chip) text = chip;
  else if (v.none) text = chip ?? v.placeholder;
  // A playbook template's chart level ("{pivot}") reads as written (lib/agent/knowledge/playbook-templates).
  else if (typeof (c.value as unknown) === "string") text = String(c.value);
  else if ((c.value ?? 0) === 0 && v.zero) text = v.zero;
  else {
    const n = c.value ?? 0;
    const number = v.prefix === "$" ? money(n) : `${v.prefix ? `${v.prefix} ` : ""}${n}`;
    const suffix = n === 1 && v.suffix === "days" ? "day" : v.suffix;
    text = number + (suffix ? (/^[%×]/.test(suffix) ? suffix : ` ${suffix}`) : "");
  }
  if (vars?.mode === "from" && chip) text += ` ${vars.word ? vars.word(c) : "from"} ${chip}`;
  // A setting shows only when it isn't the default: "· only on the close", ", counting from the day after".
  const set = c.settings ?? {};
  for (const s of settingDefs(c)) {
    const value = set[s.key];
    if (value === undefined || value === s.default) continue;
    const option = s.options?.find((o) => o.value === value);
    if (option) text += ` · ${option.label.toLowerCase()}`;
    else if (s.words) text += s.words(value, set);
  }
  return text;
}

/** A condition in a sentence: the measure's own phrase if it has one, else its two halves in words. */
export function conditionText(c: Condition): string {
  const m = measureOf(c);
  const words = valueText(c, "words");
  if (m.says) return m.says(c, words);
  return `${conditionParts(c).label} ${words}`.trim();
}

export function whenText(w: When): string {
  return conditionsOf(w).map(conditionText).join(" and ");
}

/** The whole trigger: "Sell if below $868". A clock has no "if": "Review every 30 days". */
export function triggerText(action: string, w: When): string {
  return labelled(actionLabel(action), w);
}

function labelled(label: string, w: When): string {
  return `${!isGroup(w) && measureOf(w).timed ? label.replace(/ if$/, "") : label} ${whenText(w)}`;
}

/** A trigger's pill: two halves per condition, with "and" between conditions. */
export function pillParts(w: When): PillPart[] {
  return conditionsOf(w).map(conditionParts);
}

/**
 * A stored trigger in words, the way the pill and every agent read it: "Sell
 * if below $868", "Stop watching if below $46.50", "Trim 30% if above $150".
 * A removed condition reads as one, never as a blank.
 */
export function sentenceOf(t: { action: string; predicate: unknown; trimPct?: number | null }): string {
  const w = shapeOf(t.predicate);
  const label = triggerLabel(t);
  return w ? labelled(label, w) : `${label} a removed condition`;
}

/** A stored condition in words, without the action: "below $868". */
export function conditionSentence(p: unknown): string {
  const w = shapeOf(p);
  return w ? whenText(w) : "a removed condition";
}
