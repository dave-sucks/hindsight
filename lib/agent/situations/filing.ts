/**
 * A filing trigger fired or is true now: the trigger watches the stock's
 * filings. Rule: the fires and matches whose condition watches `filing`
 * (step-6 attach, 9e323ec9:lib/agent/playbooks/attach.ts).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const filing: SituationDefinition<"FILING"> = {
  code: "FILING",
  order: 7,
  appliesTo: "both",
  entry: "row",
  guidance: "",
  lists: () => true,
  rule: (stock, book, now) => {
    const items = itemsFor(stockFacts(stock, book, now), "FILING");
    if (items.length === 0) return { active: false };
    return { active: true, data: { flag: firstFlag(items), fires: items.map((i) => i.ref) } };
  },
};
