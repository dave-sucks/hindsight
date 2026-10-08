/**
 * A review: the review clock came due (work-flag.ts `reviewDueFlag`, not a
 * seed's first), or a review trigger fired or is true now that no other
 * situation claims; and every fire nothing else claims (QB ruling,
 * 2026-10-07), so no fire leaves the list.
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const reviewDue: SituationDefinition<"REVIEW_DUE"> = {
  code: "REVIEW_DUE",
  order: 11,
  appliesTo: "both",
  entry: "row",
  guidance: "",
  lists: () => true,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const items = itemsFor(facts, "REVIEW_DUE");
    const clock = facts.clock?.kind === "REVIEW_DUE" && facts.clock.pendingFirstReview !== true ? facts.clock : null;
    if (items.length === 0 && !clock) return { active: false };
    return {
      active: true,
      data: {
        // A fire or match ranks above the clock (work-flag.ts).
        flag: firstFlag(items) ?? clock ?? undefined,
        fires: items.map((i) => i.ref),
        ...(clock ? { clock } : {}),
      },
    };
  },
};
