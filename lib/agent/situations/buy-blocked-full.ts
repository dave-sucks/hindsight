/**
 * A buy fired (or is true now) on a stock we don't hold while its analyst is
 * full. Rule: capacity.ts `buyBlockedByFull`, as get_theses computes it (the
 * buy's own last fire within a week, or the lead a buy true now).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const buyBlockedFull: SituationDefinition<"BUY_BLOCKED_FULL"> = {
  code: "BUY_BLOCKED_FULL",
  order: 4,
  appliesTo: "watched",
  entry: "row",
  guidance: "",
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    if (!facts.blocked) return { active: false };
    const items = itemsFor(facts, "BUY_BLOCKED_FULL");
    const reached = stock.resolved?.actionability === "ENTER_NOW";
    return {
      active: true,
      data: {
        flag: firstFlag(items),
        fires: items.map((i) => i.ref),
        blocked: facts.blocked,
        ...(reached ? { levelReached: { triggerDetail: stock.resolved?.triggerDetail ?? null } } : {}),
      },
    };
  },
};
