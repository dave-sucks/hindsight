/**
 * The add-or-winner playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 3).
 *
 * Written once from the text it replaced: the trigger run's add-to-a-holding
 * block (strength fire, pullback fire, hold or take) and its declined-add
 * line, and the morning run's press-hold-take bullet. There is no flag for a
 * winner near its target (RUNNING_WINNER was deleted 2026-08-25): the row
 * attaches it from the resolver's progressToTarget, and the threshold lives
 * here in code, not in the text.
 *
 * Cap: 2,000 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";

/** How far from entry to target a holding has come before it is a decision point. */
export const NEAR_TARGET = 0.75;

const TEXT = `When: an add trigger fired on a stock we hold, or a holding has come three quarters of the way to its target or more. It is a decision point, not a hold by default.

Answer, in order:
1. Why did it move? Read get_stock_data, and get_market_context for a drop. A rise counts only if it confirms the thesis: the catalyst playing out, estimates or targets rising, healthy structure (a new high after a pause, above a rising average), and not an exhaustion chase (already far up on the day, RSI blowing off). A drop counts only if it is market- or sector-wide, with the thesis intact (no guidance or estimate cut, no broken catalyst, no bad company headline) and the price holding support.
2. Does the live price still confirm, with no headline against it, and does the reward to a justified target still beat the risk?
3. Did the principal decline this same add, with nothing they named changed since? Then say so and pass.

What you can do (one of these):
- Press: manage_position add_to_position (it sizes the add: half the entry's risk, within the largest trade and the most in one stock), then update_thesis to raise the target, and raise the floor under the bigger position.
- Hold: raise the floor to lock a real share of the gain, under structure (a recent swing low, the breakout level), with update_thesis stop_loss or manage_position update_targets. Breakeven only guards against a loss: a +20% winner floored at breakeven can give back its whole gain.
- Take: manage_position partial_close to bank part, or close_position.
Then one update_thesis saying which and why. Adds and target raises are proposals the principal approves.

Answered: one of the three, made with its tool, and that update_thesis.

Mistakes:
- Adding into company-specific weakness: that is averaging into a loser.
- Adding into an exhaustion spike.
- Holding a winner by default when it asks to be re-underwritten.`;

export const addOrWinner: Playbook = {
  key: "add-or-winner",
  cap: 2_000,
  text: TEXT,
  /** A held stock whose lead flag is a fired or matching add, or that has come most of the way to its target. */
  appliesToRow: (row) => {
    if (row.status !== "HOLDING") return false;
    const lead = row.needsAction as { kind?: string; action?: string } | null | undefined;
    if ((lead?.kind === "TRIGGER_FIRED" || lead?.kind === "TRIGGER_MATCHING_NOW") && lead.action === "ADD") return true;
    const progress = (row.resolved as { progressToTarget?: unknown } | null | undefined)?.progressToTarget;
    return typeof progress === "number" && progress >= NEAR_TARGET;
  },
  /** An add fired on a stock we hold. */
  appliesToFire: ({ action, held }) => held && action === "ADD",
};
