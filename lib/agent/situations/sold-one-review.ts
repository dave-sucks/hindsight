/**
 * A stock sold in the last two weeks that no run has answered for: the one
 * look a sold stock gets. Rule: ./sold-review.ts `soldReview` (moved from lib/agent).
 */
import { soldReview } from "./sold-review";
import type { SituationDefinition } from "./types";

export const soldOneReview: SituationDefinition<"SOLD_ONE_REVIEW"> = {
  code: "SOLD_ONE_REVIEW",
  order: 15,
  appliesTo: "watched",
  entry: "row",
  guidance: "",
  // On the read's sold list, not a row.
  lists: () => true,
  rule: (stock, _book, now) => {
    const review = stock.sold ? soldReview({ ...stock.sold, now }) : null;
    return review ? { active: true, data: { review } } : { active: false };
  },
};
