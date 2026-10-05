/**
 * The words: one sentence and one pill per condition. Each measure writes
 * its own clause and pill (its catalog entry); settings that carry words
 * add theirs. The line under the input, the pill on the sheet and (from PR
 * 3) the Activity line and the agent's fire payload all come from here, so a
 * trigger reads the same everywhere. docs/plans/TRIGGER_TYPES.md §6.
 *
 * Pure and client-safe.
 */

import { measureOf, settingDefs } from "./catalog";
import type { PillPart } from "./measure";
import type { Condition, When } from "./types";
import { conditionsOf, isGroup } from "./types";

export { money } from "./words";

/** One condition as a clause: "the price falls below $248". `inGroup` words a clock as a state. */
export function conditionSentence(c: Condition, opts: { inGroup?: boolean } = {}): string {
  const set = c.settings ?? {};
  const extra = settingDefs(c)
    .map((s) => (s.words && set[s.key] !== undefined ? s.words(set[s.key], set) : ""))
    .join("");
  return measureOf(c).sentence(c, opts) + extra;
}

/** The line under the input: "Fires when the price falls below $248." */
export function fireLine(c: Condition): string {
  const s = conditionSentence(c);
  return measureOf(c).timed ? `Fires ${s}.` : `Fires when ${s}.`;
}

export function whenSentence(w: When): string {
  if (!isGroup(w)) return conditionSentence(w, { inGroup: true });
  return w.conditions.map(whenSentence).join(w.match === "all" ? " and " : " or ");
}

const VERB: Readonly<Record<string, string>> = { ENTER: "Buy", ADD: "Add", TRIM: "Trim", EXIT: "Sell", MOVE_STOP: "Move the stop" };

/** The verb a trigger's action reads as. A sale on a stock we don't own takes the plan down. */
export function actionVerb(action: string, held?: boolean): string {
  if (action === "EXIT" && held === false) return "Take the plan down";
  return VERB[action] ?? "Review";
}

/** The whole trigger as one sentence: "Sell when the price falls below $248." */
export function triggerSentence(action: string, w: When, held?: boolean): string {
  const verb = actionVerb(action, held);
  if (!isGroup(w) && measureOf(w).timed) return `${verb} ${conditionSentence(w)}.`;
  return `${verb} when ${whenSentence(w)}.`;
}

export function pillPart(c: Condition): PillPart {
  return measureOf(c).pill(c);
}

/** A trigger's pill: one part per condition, with "and" / "or" between them. */
export function pillParts(w: When): { parts: PillPart[]; joiner: "and" | "or" } {
  return { parts: conditionsOf(w).map(pillPart), joiner: isGroup(w) && w.match === "any" ? "or" : "and" };
}
