/**
 * A seed is due its first research. Rule: work-flag.ts `reviewDueFlag`
 * with pendingFirstReview (the review clock came due on a stock with no
 * direction yet).
 */
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 first-research text (9e323ec9). Cap 1,200 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: a seed is due its first research: a stock put on the watchlist with no view yet.

Answer, in order:
1. Is there a tradeable view? Pull get_stock_data and what else you need.

What you can do:
- Commit a view: update_thesis with direction LONG or SHORT, horizon, entry_price, target_price, stop_loss, core_belief, key_assumptions (two or more), invalidation_conditions (two or more), triggers and a rationale. It stays on watch with its buy trigger; the save refuses a commitment missing a structural field.
- Pass: update_thesis with direction PASS, invalidation_conditions (one or more) and a rationale. It leaves the watchlist and stays on the stock's page as a decision.

Answered: one of the two. A note with no direction leaves the seed where it is, to be asked again tomorrow.

Mistakes:
- Taking a watch with no clock for a seed: a seed comes due on its clock; a watch with no clock comes back only when one of its wakes fires.`;

export const firstResearch: SituationDefinition<"FIRST_RESEARCH"> = {
  code: "FIRST_RESEARCH",
  order: 10,
  appliesTo: "watched",
  entry: "line",
  guidance: GUIDANCE,
  lists: () => true,
  rule: (stock, book, now) => {
    const { clock } = stockFacts(stock, book, now);
    if (clock?.kind !== "REVIEW_DUE" || clock.pendingFirstReview !== true) return { active: false };
    return { active: true, data: { flag: clock } };
  },
};
