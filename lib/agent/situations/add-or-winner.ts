/**
 * An add on a holding, or a holding near its target: an add trigger fired or
 * is true now, or the holding has come three quarters of the way from entry
 * to target. Rule: the fires and matches with action ADD on a holding, and
 * the resolver's progressToTarget against the step-6 threshold
 * (9e323ec9:lib/agent/playbooks/add-or-winner.ts).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/** How far from entry to target a holding has come before it is a decision point. */
export const NEAR_TARGET = 0.75;

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 add-or-winner text (9e323ec9). Cap 2,000 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: an add trigger fired or is true now on a stock we hold, or a holding has come three quarters of the way to its target or more. It is a decision point, not a hold by default.

Answer, in order:
1. Why did it move? Read get_stock_data, and get_market_context for a drop. A rise counts only if it confirms the thesis: the catalyst playing out, estimates or targets rising, healthy structure (a new high after a pause, above a rising average), and not an exhaustion chase (already far up on the day, RSI blowing off). A drop counts only if it is market- or sector-wide, with the thesis intact (no guidance or estimate cut, no broken catalyst, no bad company headline) and the price holding support.
2. Does the live price still confirm, with no headline against it, and does the reward to a justified target still beat the risk?
3. Did the principal decline this same add, with nothing they named changed since? Then say so and pass.

What you can do (one of these):
- Press: manage_position add_to_position (it sizes the add: half the entry's risk, within the largest trade and the most in one stock), then update_thesis to raise the target, and the floor (stop_loss) under the bigger position.
- Hold: raise the floor to lock a real share of the gain, under structure (a recent swing low, the breakout level), with update_thesis stop_loss. Breakeven only guards against a loss: a +20% winner floored at breakeven can give back its whole gain.
- Take: manage_position partial_close to bank part, or close_position.
Then one update_thesis saying which and why. Adds and target raises are proposals the principal approves.

Answered: one of the three, made with its tool, and that update_thesis.

Mistakes:
- Adding into company-specific weakness: that is averaging into a loser.
- Adding into an exhaustion spike.
- Holding a winner by default when it asks to be re-underwritten.`;

export const addOrWinner: SituationDefinition<"ADD_OR_WINNER"> = {
  code: "ADD_OR_WINNER",
  order: 5,
  appliesTo: "held",
  entry: "row",
  guidance: GUIDANCE,
  // An add that fired or is true now lists the stock; nearing the target alone does not.
  lists: (data) => data.flag != null,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const items = itemsFor(facts, "ADD_OR_WINNER");
    const progress = stock.resolved?.progressToTarget;
    const near = facts.held && typeof progress === "number" && progress >= NEAR_TARGET;
    if (items.length === 0 && !near) return { active: false };
    return {
      active: true,
      data: {
        flag: firstFlag(items),
        fires: items.map((i) => i.ref),
        ...(near ? { progressToTarget: progress as number } : {}),
      },
    };
  },
};
