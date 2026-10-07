/**
 * The one place a number is held to its range. Each measure's entry says
 * where its numbers may sit (`value.range`, `value.ranges`, a setting's
 * `range`); this turns that into the sentence a refusal says. The form, the
 * save and the agents' schema all call `conditionRefusal`, so they refuse the
 * same number with the same words.
 *
 * Pure and client-safe.
 */

import { measureOf, settingDefs } from "./catalog";
import type { Condition, Range, SettingDef } from "./types";
import { isNum, shown } from "./words";

/** The range that holds for this condition's number: the first button or variable that matches, else the entry's own. */
export function valueRange(c: Condition): Range | undefined {
  const v = measureOf(c).value;
  const hit = v.ranges?.find((r) => (r.is == null || r.is === c.is) && (r.variables == null || (c.variable != null && r.variables.includes(c.variable))));
  return hit?.range ?? v.range;
}

const tight = (unit: string | undefined) => unit != null && /^[%×]/.test(unit);

/** A number as the sentence shows it: "$12.5", "-$5", "15%", "60×", "7 days". */
function shownIn(n: number, unit: string | undefined, last: boolean): string {
  const v = String(Math.round(n * 10000) / 10000);
  if (unit === "$") return n < 0 ? `-$${v.slice(1)}` : `$${v}`;
  if (!unit) return v;
  return tight(unit) || last ? `${v}${unit}` : v;
}

/** "more than 0% and up to 10%", "a whole number from 1 to 365 days". */
export function rangeWords(r: Range): string {
  const at = (n: number, last: boolean) => shownIn(n, r.unit, last);
  const low = r.over != null ? { n: r.over, word: "more than" } : r.min != null ? { n: r.min, word: "" } : null;
  const high = r.under != null ? { n: r.under, word: "under" } : r.max != null ? { n: r.max, word: "up to" } : null;
  let words: string;
  if (low && high) {
    words = !low.word && high.word === "up to" ? `from ${at(low.n, false)} to ${at(high.n, true)}` : `${low.word || ""}${low.word ? " " : ""}${at(low.n, false)}${low.word ? "" : " or more"} and ${high.word} ${at(high.n, true)}`;
  } else if (low) {
    words = low.word ? `more than ${at(low.n, true)}` : `${at(low.n, true)} or more`;
  } else if (high) {
    words = `${high.word} ${at(high.n, true)}`;
  } else {
    words = "a number";
  }
  return r.integer ? `a whole number ${words.startsWith("from") ? words : `that is ${words}`}` : words;
}

/** A range in a few characters, for a tool definition: ">0 to 50×", "1 to 14 days", "1% to <100%". The refusal says it in full. */
export function rangeShort(r: Range): string {
  const at = (n: number, last: boolean) => shownIn(n, r.unit, last);
  const low = r.over != null ? `>${at(r.over, false)}` : r.min != null ? at(r.min, false) : null;
  const high = r.under != null ? `<${at(r.under, true)}` : r.max != null ? at(r.max, true) : null;
  return low && high ? `${low} to ${high}` : low ? (r.over != null ? low : `${low} or more`) : high ? `up to ${high}` : "a number";
}

/** The sentence for a number outside its range, or null when it is inside. */
export function rangeProblem(v: unknown, r: Range): string | null {
  const ok =
    isNum(v) &&
    (!r.integer || Number.isInteger(v)) &&
    (r.min == null || v >= r.min) &&
    (r.max == null || v <= r.max) &&
    (r.over == null || v > r.over) &&
    (r.under == null || v < r.under);
  if (ok) return null;
  const sent = isNum(v) ? shownIn(v, r.unit, true) : v == null ? "nothing" : JSON.stringify(v);
  return `${r.what} takes ${rangeWords(r)}; ${sent} isn't.${r.why ? ` ${r.why}` : ""}`;
}

/**
 * Why a setting's value is refused, or null: outside its range, or none of
 * its choices (the RSI's length is 2 or 14). The save and the agents' schema
 * both say it, so a model reads the same sentence the form shows.
 */
export function settingRefusal(s: SettingDef, v: unknown): string | null {
  if (v === undefined) return null;
  if (s.range) {
    const p = rangeProblem(v, s.range);
    if (p) return `${p} Leave \`${s.key}\` out unless you mean it.`;
  }
  if (s.options && !s.options.some((o) => o.value === v)) {
    return `\`${s.key}\` takes one of ${s.options.map((o) => String(o.value)).join(", ")}; ${shown(v)} isn't. Leave \`${s.key}\` out unless you mean it.`;
  }
  return null;
}

/**
 * Why the save refuses one condition, or null: it doesn't fit its measure,
 * its number or a setting is out of range, or a fact about the numbers fails.
 */
export function conditionRefusal(c: Condition): string | null {
  const m = measureOf(c);
  if (!m.fits(c)) return m.shape;
  const replaced = m.variables?.mode === "replace" && c.variable != null;
  const range = valueRange(c);
  if (!m.value.none && !replaced && range && !(m.value.zero != null && c.value == null)) {
    const p = rangeProblem(c.value, range);
    if (p) return p;
  }
  for (const s of settingDefs(c)) {
    const p = settingRefusal(s, c.settings?.[s.key]);
    if (p) return p;
  }
  return m.rule?.(c) ?? null;
}
