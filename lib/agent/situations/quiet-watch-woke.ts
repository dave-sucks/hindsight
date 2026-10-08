/**
 * A quiet watch woke: a review fired or is true now on a watched stock with
 * no direction and no review clock of its own. Rule: the step-6 quiet-watch
 * attachment (9e323ec9:lib/agent/playbooks/quiet-watch.ts), narrowed to a
 * review (QB ruling, 2026-10-07).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 quiet-watch text (9e323ec9). Cap 1,200 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: a review fired or is true now on a watch with no clock: no direction, no plan, no review schedule, only wakes you set. It asks one question: do you want this stock back?

Answer, in order:
1. What changed since you set the wake? Check with get_stock_data.

What you can do (one of these):
- Bring it back: update_thesis committing the full view (direction, horizon, prices, belief, assumptions, invalidation conditions, triggers), as a first research does.
- Re-arm it: update_thesis with edit_triggers moving the wakes to the levels that matter now. Add a review clock (add_triggers watching "repeat") only if the stock has earned one, and say why.
- Let it go: update_thesis with change_status ARCHIVED.

Answered: one of the three. A note that changes nothing lets the same wake fire again tomorrow.

Mistakes:
- Deciding the same wake again every day.`;

export const quietWatchWoke: SituationDefinition<"QUIET_WATCH_WOKE"> = {
  code: "QUIET_WATCH_WOKE",
  order: 8,
  appliesTo: "watched",
  entry: "full",
  guidance: GUIDANCE,
  lists: () => true,
  rule: (stock, book, now) => {
    const items = itemsFor(stockFacts(stock, book, now), "QUIET_WATCH_WOKE");
    if (items.length === 0) return { active: false };
    return { active: true, data: { flag: firstFlag(items), fires: items.map((i) => i.ref) } };
  },
};
