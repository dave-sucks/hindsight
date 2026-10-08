/**
 * A sale on a holding: a sale or trim trigger fired or is true now, or the
 * principal declined the sale and the price is still past the line. Rule:
 * work-flag.ts `saleDeclinedFlag`, and the fires and matches with action
 * EXIT or TRIM on a holding (`openFireWork`, `matchingWork`).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 protective-sale text (9e323ec9). Cap 1,500 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: a sale or trim trigger fired or is true now on a stock we hold, or the principal declined that sale and the price is still past the line.

Answer, in order:
1. Is the price past the line now (get_stock_data)? A give-back counts from the tracked high, kept over the whole holding, not from a high read off a chart window.
2. Did the principal decline it? Their words are in what's been said; the row has the count and the recent low.

What you can do:
- Sell: close_position with reason STOP, answering belief_survived as its description says, or trim with manage_position partial_close; then one update_thesis saying why.
- After a decline, propose the sale again with today's reasons; a sale asks every day its condition holds. Say which day of the breach it is, quote their note, and offer the recent low as a level for the line.
- Or re-draw the line: update_thesis with edit_triggers on the fired trigger's id, as a price under structure you name, and say when you will look again. A declined line may come down at most 15%; nothing else may be loosened.
- Two sales fired together: one decision covers both (all, some or none); name the rule you followed.

Answered: a sale or trim, or the line re-drawn with update_thesis. A review that changes nothing is no answer.

Mistakes:
- Calling the fire false with a different high; declining a sale takes new evidence about the business.
- Going quiet after a decline.
- Removing a protective trigger or widening a trail: the save refuses both.`;

export const protectiveSale: SituationDefinition<"PROTECTIVE_SALE"> = {
  code: "PROTECTIVE_SALE",
  order: 2,
  appliesTo: "held",
  entry: "row",
  guidance: GUIDANCE,
  lists: () => true,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const items = itemsFor(facts, "PROTECTIVE_SALE");
    if (!facts.declined && items.length === 0) return { active: false };
    return { active: true, data: { flag: facts.declined ?? firstFlag(items), fires: items.map((i) => i.ref) } };
  },
};
