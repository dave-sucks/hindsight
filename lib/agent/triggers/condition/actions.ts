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
import { isWindowIn } from "./rules";

/** The order the dialog lists them in. */
export const DIALOG_ACTIONS: readonly TriggerAction[] = ["ENTER", "ADD", "TRIM", "EXIT", "STOP_WATCHING", "REVIEW"];

export const SELL_ON_A_WATCH =
  'There is nothing to sell on a stock we only watch, so a "Sell if" line (action EXIT) is for a holding. To end the watch at a price, use action STOP_WATCHING ("Stop watching if below $X"), with settings: { close: true } to read it on the close.';
export const STOP_WATCHING_ON_A_HOLDING = 'A "Stop watching if" line (action STOP_WATCHING) is for a stock we only watch. On a holding, a sale is action EXIT ("Sell if").';
export const STOP_WATCHING_IS_THE_STOCKS = "Stop watching is a stock's own line: an account or analyst rule can't end a watch.";

/**
 * Why this action can't be on this trigger, or null. A sale needs a position to sell; ending a watch needs a
 * watch, on the stock itself. `standing`: an analyst or account rule.
 */
export const PORTFOLIO_MANAGER_IS_THE_ACCOUNTS = "Running the Portfolio Manager is the account's own trigger, on the market (Settings → Triggers). A stock's trigger and a rule every stock inherits can't take it.";
export const MARKET_IS_THE_ACCOUNTS = "The S&P's move is the account's own trigger: it runs the Portfolio Manager (Settings → Triggers). A stock's trigger and a rule every stock inherits can't watch it.";

export function actionProblem(action: string, ctx: { held: boolean; standing?: boolean }): string | null {
  if (action === "RUN_PORTFOLIO_MANAGER") return PORTFOLIO_MANAGER_IS_THE_ACCOUNTS;
  if (action === "STOP_WATCHING") return ctx.standing ? STOP_WATCHING_IS_THE_STOCKS : ctx.held ? STOP_WATCHING_ON_A_HOLDING : null;
  return action === "EXIT" && !ctx.held && !ctx.standing ? SELL_ON_A_WATCH : null;
}

/**
 * `held` is true on a stock we own; `standing` on an analyst or account rule,
 * which applies to stocks owned and not. A buy on a stock we already own and
 * an add or a trim on one we don't would ask for something that can't happen.
 */
export function allowedActions(w: When, ctx: { held: boolean; standing: boolean }): TriggerAction[] {
  const listed = conditionsOf(w).reduce<readonly TriggerAction[]>((acc, c) => {
    // A window bounds the others: they decide what the trigger does.
    const own = isWindowIn(w, c) ? undefined : measureOf(c).actions;
    return own ? acc.filter((a) => own.includes(a)) : acc;
  }, DIALOG_ACTIONS);
  return listed.filter((a) => {
    if (actionProblem(a, ctx)) return false;
    if (ctx.standing) return true;
    if (a === "ENTER") return !ctx.held;
    if (a === "ADD" || a === "TRIM") return ctx.held;
    return true;
  });
}
