/**
 * An earnings trigger fired or is true now: the trigger watches a report date
 * or a surprise. Rule: the fires and matches whose condition watches `report`
 * or `surprise` (step-6 attach, 9e323ec9:lib/agent/playbooks/attach.ts).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const earnings: SituationDefinition<"EARNINGS"> = {
  code: "EARNINGS",
  order: 6,
  appliesTo: "both",
  entry: "row",
  guidance: "",
  rule: (stock, book, now) => {
    const items = itemsFor(stockFacts(stock, book, now), "EARNINGS");
    if (items.length === 0) return { active: false };
    return { active: true, data: { flag: firstFlag(items), fires: items.map((i) => i.ref) } };
  },
};
