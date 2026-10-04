/**
 * The checks: what's wrong with a condition, in one plain sentence, or null.
 * The dialog shows the message under the input. A check never changes the
 * form, it only says what to fix. docs/plans/TRIGGER_TYPES.md §3.2.
 *
 * Pure and client-safe.
 */

import { LEVEL_ELIGIBLE_KINDS, THESIS_ADDABLE_KINDS } from "../addable";
import type { TriggerPredicate } from "../types";
import { tabOfCondition } from "./catalog";
import { toLegacy } from "./legacy";
import type { Condition, When } from "./types";
import { conditionsOf, isGroup } from "./types";
import { isPositionVariable } from "./variables";

export interface CheckContext {
  /** Where the trigger is stored. */
  level: "THESIS" | "ANALYST" | "ACCOUNT";
  /** We own the stock (a thesis at HOLDING). Ignored at the analyst and account levels. */
  held: boolean;
}

export function conditionProblem(c: Condition, ctx: CheckContext): string | null {
  const tab = tabOfCondition(c);
  const def = tab.value;
  const standing = ctx.level !== "THESIS";
  const replacing = tab.variables?.mode === "replace" && c.variable != null;

  if (!def.none && !replacing) {
    const v = c.value;
    if (v == null || !Number.isFinite(v)) return c.watch === "price" && c.unit !== "%" ? "Enter a price, or use a price variable." : "Enter a number.";
    if (v < 0 && !def.allowNegative) return "Use a positive number. The buttons set the direction.";
    if (def.integer && !Number.isInteger(v)) return "Use a whole number.";
    if (def.min != null && v < def.min) return `Use ${def.min} or more.`;
    if (def.max != null && v > def.max) return `Use ${def.max} or less.`;
    if (c.watch === "price" && c.unit !== "%" && v === 0) return "Enter a price, or use a price variable.";
  }

  if (c.watch === "price" && c.unit !== "%" && !c.variable && standing) {
    return "A typed price can't apply to every stock. Use a price variable instead, like the 200-day average.";
  }
  if (c.watch === "price" && c.unit === "%") {
    if (!c.variable) return "Choose what the % is measured from.";
    if (c.is === "near" && (c.value ?? 0) === 0) return "Near needs a distance, such as 2%.";
    if (c.is === "below" && (c.value ?? 0) >= 100) return "A fall of 100% or more can't happen.";
  }
  if (c.variable === "peak" && c.is !== "below") return "The price can't rise above the high since we bought. Pick Below.";
  if (isPositionVariable(c.variable) && ctx.level === "THESIS" && !ctx.held) {
    return "Our entry and the high since we bought exist only once we own the stock.";
  }
  if (c.watch === "report" && c.is === "before" && (c.value ?? 0) > 14) return "The earnings calendar looks 14 days ahead.";
  if (c.watch === "schedule" && c.is !== "every") {
    if (!c.variable) return "Choose what to count from.";
    if (c.variable === "buy" && c.is === "before") return "The buy is already in the past. Pick After.";
  }

  // Until the cutover the server stores today's kinds, so a condition no
  // kind can say is held back (docs/plans/TRIGGER_TYPES.md, PR 1).
  const legacy = toLegacy(c);
  if (!legacy) return "Not available yet: today's triggers can't say this. It arrives with the cutover.";
  return kindProblem(legacy, ctx);
}

/** The first problem in a trigger's condition(s), including the rules for two. */
export function whenProblem(w: When, ctx: CheckContext): string | null {
  if (isGroup(w)) {
    if (w.conditions.length !== 2 || w.conditions.some(isGroup)) return "A trigger built here takes one condition or two.";
    if (conditionsOf(w).some((c) => c.watch === "schedule")) return "A schedule stands alone. Add it as its own trigger.";
  }
  for (const c of conditionsOf(w)) {
    const problem = conditionProblem(c, ctx);
    if (problem) return problem;
  }
  return null;
}

function kindProblem(p: TriggerPredicate, ctx: CheckContext): string | null {
  const allowed = ctx.level === "THESIS" ? THESIS_ADDABLE_KINDS : LEVEL_ELIGIBLE_KINDS;
  if (allowed.has(p.kind)) return null;
  return ctx.level === "THESIS"
    ? "That can't be added to a stock by hand."
    : "That can't be a standing rule: it has to mean the same thing on every stock.";
}
