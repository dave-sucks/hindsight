/**
 * A buy arrives on a stock we don't hold: a buy trigger fired or is true now,
 * or the resolver reads its level as reached (ENTER_NOW), and the buy is not
 * one the analyst is too full to take (BUY_BLOCKED_FULL has those). Rule: the
 * fires and matches with action ENTER (`openFireWork`, `matchingWork`, a
 * pending buy proposal left out as today), and resolved-thesis.ts's
 * actionability.
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const buyArrives: SituationDefinition<"BUY_ARRIVES"> = {
  code: "BUY_ARRIVES",
  order: 3,
  appliesTo: "watched",
  entry: "row",
  guidance: "",
  // A fired or true-now buy is a flag; a level reached is the resolver's ENTER_NOW, which lists too.
  lists: () => true,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const items = itemsFor(facts, "BUY_ARRIVES");
    const reached = !facts.held && facts.blocked == null && stock.resolved?.actionability === "ENTER_NOW";
    if (items.length === 0 && !reached) return { active: false };
    return {
      active: true,
      data: {
        flag: firstFlag(items),
        fires: items.map((i) => i.ref),
        ...(reached ? { levelReached: { triggerDetail: stock.resolved?.triggerDetail ?? null } } : {}),
      },
    };
  },
};
