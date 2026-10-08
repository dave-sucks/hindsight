/**
 * A promoted stock awaiting the live decision. Rule: work-flag.ts
 * `promotedFlag` (status PROMOTED).
 */
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: written from
 * complete_run's refusal for a promoted row and the work flag's description;
 * no prompt block exists. Cap 1,200 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: this stock was promoted to live money and its paper position was closed at promotion. It needs a decision this run. The row carries the paper record: days held, the paper result, the number of reviews.

Answer, in order:
1. Does the case still hold at today's price? Check with get_stock_data against the thesis and its levels.

What you can do (one of these):
- Re-enter live: place_trade.
- Defer: update_thesis with change_status "WATCHING". The next run looks at it again.

Answered: place_trade, or that update_thesis.

Mistakes:
- A note in place of the decision: the stock stays promoted and is asked again on the next run.`;

export const promotedAwaiting: SituationDefinition<"PROMOTED_AWAITING"> = {
  code: "PROMOTED_AWAITING",
  order: 1,
  appliesTo: "held",
  entry: "row",
  guidance: GUIDANCE,
  // A promoted stock is resolved this run.
  lists: () => true,
  rule: (stock, book, now) => {
    const { promoted } = stockFacts(stock, book, now);
    return promoted ? { active: true, data: { flag: promoted } } : { active: false };
  },
};
