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
import { shapeOf } from "./legacy";
import { variableDef } from "./variables";
import { money } from "./words";

export { money } from "./words";

const ACTION_LABEL: Readonly<Record<string, string>> = { ENTER: "Buy if", ADD: "Add if", TRIM: "Trim if", EXIT: "Sell if", MOVE_STOP: "Move the stop if" };

/** "Sell if", "Review if". A sale on a stock we don't own takes the plan down. */
export function actionLabel(action: string, sells = true): string {
  if (action === "EXIT" && !sells) return "Take the plan down if";
  return ACTION_LABEL[action] ?? "Review if";
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
  else if ((c.value ?? 0) === 0 && v.zero) text = v.zero;
  else {
    const n = c.value ?? 0;
    const number = v.prefix === "$" ? money(n) : `${v.prefix ? `${v.prefix} ` : ""}${n}`;
    const suffix = n === 1 && v.suffix === "days" ? "day" : v.suffix;
    text = number + (suffix ? (/^[%×]/.test(suffix) ? suffix : ` ${suffix}`) : "");
  }
  if (vars?.mode === "from" && chip) text += ` ${vars.word ? vars.word(c) : "from"} ${chip}`;
  // A setting shows only when it isn't the default: "· only on the close", ", once it has been up 20%".
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
  if (!isGroup(w)) return conditionText(w);
  return w.conditions.map(whenText).join(w.match === "all" ? " and " : " or ");
}

/** The whole trigger: "Sell if below $868". A clock has no "if": "Review every 30 days". */
export function triggerText(action: string, w: When, sells = true): string {
  const label = actionLabel(action, sells);
  return `${!isGroup(w) && measureOf(w).timed ? label.replace(/ if$/, "") : label} ${whenText(w)}`;
}

/** A trigger's pill: two halves per condition, with "and" / "or" between conditions. */
export function pillParts(w: When): { parts: PillPart[]; joiner: "and" | "or" } {
  return { parts: conditionsOf(w).map(conditionParts), joiner: isGroup(w) && w.match === "any" ? "or" : "and" };
}

/**
 * A stored trigger in words, the way the pill and every agent read it: "Sell
 * if below $868". `sells` is false on a stock we don't own (a sale there takes
 * the plan down). A removed condition reads as one, never as a blank.
 */
export function sentenceOf(t: { action: string; predicate: unknown }, sells = true): string {
  const w = shapeOf(t.predicate);
  return w ? triggerText(t.action, w, sells) : `${actionLabel(t.action, sells)} a removed condition`;
}

/** A stored condition in words, without the action: "below $868". */
export function conditionSentence(p: unknown): string {
  const w = shapeOf(p);
  return w ? whenText(w) : "a removed condition";
}
