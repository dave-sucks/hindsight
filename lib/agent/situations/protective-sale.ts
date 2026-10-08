/**
 * A sale on a holding: a sale or trim trigger fired or is true now, or the
 * principal declined the sale and the price is still past the line. Rule:
 * needs-action.ts `saleDeclinedFlag`, and the fires and matches with action
 * EXIT or TRIM on a holding (`openFireWork`, `matchingWork`).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const protectiveSale: SituationDefinition<"PROTECTIVE_SALE"> = {
  code: "PROTECTIVE_SALE",
  order: 2,
  appliesTo: "held",
  entry: "row",
  guidance: "",
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const items = itemsFor(facts, "PROTECTIVE_SALE");
    if (!facts.declined && items.length === 0) return { active: false };
    return { active: true, data: { flag: facts.declined ?? firstFlag(items), fires: items.map((i) => i.ref) } };
  },
};
