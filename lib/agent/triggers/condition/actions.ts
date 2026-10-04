/**
 * Which actions a condition can take, and when a sale can be proposed with
 * no analyst. One table, read by the dialog. docs/plans/TRIGGER_TYPES.md §4.
 *
 * Pure and client-safe.
 */

import type { TriggerAction } from "../types";
import type { Condition, When } from "./types";
import { conditionsOf, isGroup } from "./types";

/** The order the dialog lists them in. */
export const DIALOG_ACTIONS: readonly TriggerAction[] = ["ENTER", "ADD", "TRIM", "EXIT", "REVIEW"];

/** A repeating schedule, an earnings condition, a filing and insider buying can only ask for a review. */
function reviewOnly(c: Condition): boolean {
  switch (c.watch) {
    case "report":
    case "surprise":
    case "filing":
    case "insiders":
      return true;
    case "schedule":
      return c.is === "every";
    default:
      return false;
  }
}

/**
 * `held` is true on a stock we own; `standing` on an analyst or account rule,
 * which applies to stocks owned and not. A buy on a stock we already own and
 * an add or a trim on one we don't would ask for something that can't happen.
 */
export function allowedActions(w: When, ctx: { held: boolean; standing: boolean }): TriggerAction[] {
  if (conditionsOf(w).some(reviewOnly)) return ["REVIEW"];
  const fromDate = conditionsOf(w).some((c) => c.watch === "schedule");
  return DIALOG_ACTIONS.filter((a) => {
    if (fromDate && (a === "ENTER" || a === "ADD")) return false;
    if (ctx.standing) return true;
    if (a === "ENTER") return !ctx.held;
    if (a === "ADD" || a === "TRIM") return ctx.held;
    return true;
  });
}

/**
 * "Propose the sale right away": a sale with nothing for an analyst to judge.
 * A typed price, or a % from a prior close, our entry or the high since we
 * bought: the same set `isDirectEligiblePredicate` allows today.
 */
export function canProposeDirectly(w: When, action: TriggerAction): boolean {
  if (action !== "EXIT" || isGroup(w) || w.watch !== "price") return false;
  if (w.unit !== "%") return !w.variable;
  return w.variable === "prev_close" || w.variable === "close_5d" || w.variable === "close_20d" || w.variable === "entry" || w.variable === "peak";
}
