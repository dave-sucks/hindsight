/**
 * A stock sold in the last two weeks that no run has answered for: the one
 * look a sold stock gets. Rule: ./sold-review.ts `soldReview` (moved from lib/agent).
 */
import { soldReview } from "./sold-review";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: written from
 * the morning prompt's sold-stock sentences (system-prompt.ts) and sold-
 * review.ts's ask. Cap 1,200 characters (situations.guidance.test.ts); a
 * line added means a line removed. Not sent to any agent yet: the read that
 * carries it with the stock is a later change, which also takes the matching
 * text out of the prompts.
 */
const GUIDANCE = `When: this analyst sold the stock in the last two weeks and no run has answered for it yet. The row carries the exit price, the date, why it sold, whether the belief survived, and any catalyst still ahead. This is the one look a sold stock gets.

Answer, in order:
1. Is it worth watching again? A catalyst still ahead, a belief that survived the exit.

What you can do (one of these):
- Keep watching with a re-entry level priced off today's chart.
- Keep watching on a review cadence.
- Keep watching with nothing set (legal, and it costs nothing).
- Let it go.
Put it back on watch with update_thesis(change_status: "WATCHING") plus whatever wakes it; to let it go, write the one-line reason on an update_thesis and it clears.

Answered: one update_thesis saying which you chose and why.

Mistakes:
- Never looking at it again: a sold stock you never look at again is a thesis you already paid for and threw away.`;

export const soldOneReview: SituationDefinition<"SOLD_ONE_REVIEW"> = {
  code: "SOLD_ONE_REVIEW",
  order: 15,
  appliesTo: "watched",
  entry: "row",
  guidance: GUIDANCE,
  // On the read's sold list, not a row.
  lists: () => true,
  rule: (stock, _book, now) => {
    const review = stock.sold ? soldReview({ ...stock.sold, now }) : null;
    return review ? { active: true, data: { review } } : { active: false };
  },
};
