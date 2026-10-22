/**
 * Which actions a trigger can take. Each measure lists its actions (its
 * catalog entry); this file combines them.
 * docs/plans/TRIGGER_TYPES.md §4.
 *
 * Pure and client-safe.
 */

import type { TriggerAction } from "../types";
import { measureOf } from "./catalog";
import type { When } from "./types";
import { conditionsOf } from "./types";

/** The order the dialog lists them in. */
export const DIALOG_ACTIONS: readonly TriggerAction[] = ["ENTER", "ADD", "TRIM", "EXIT", "REVIEW"];

/**
 * `held` is true on a stock we own; `standing` on an analyst or account rule,
 * which applies to stocks owned and not. A buy on a stock we already own and
 * an add or a trim on one we don't would ask for something that can't happen.
 */
export function allowedActions(w: When, ctx: { held: boolean; standing: boolean }): TriggerAction[] {
  const listed = conditionsOf(w).reduce<readonly TriggerAction[]>((acc, c) => {
    const own = measureOf(c).actions;
    return own ? acc.filter((a) => own.includes(a)) : acc;
  }, DIALOG_ACTIONS);
  return listed.filter((a) => {
    if (ctx.standing) return true;
    if (a === "ENTER") return !ctx.held;
    if (a === "ADD" || a === "TRIM") return ctx.held;
    return true;
  });
}
