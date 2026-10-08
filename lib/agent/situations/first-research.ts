/**
 * A seed is due its first research. Rule: needs-action.ts `reviewDueFlag`
 * with pendingFirstReview (the review clock came due on a stock with no
 * direction yet).
 */
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const firstResearch: SituationDefinition<"FIRST_RESEARCH"> = {
  code: "FIRST_RESEARCH",
  order: 10,
  appliesTo: "watched",
  entry: "line",
  guidance: "",
  rule: (stock, book, now) => {
    const { clock } = stockFacts(stock, book, now);
    if (clock?.kind !== "REVIEW_DUE" || clock.pendingFirstReview !== true) return { active: false };
    return { active: true, data: { flag: clock } };
  },
};
