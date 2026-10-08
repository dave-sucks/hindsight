/**
 * A promoted stock awaiting the live decision. Rule: needs-action.ts
 * `promotedFlag` (status PROMOTED).
 */
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const promotedAwaiting: SituationDefinition<"PROMOTED_AWAITING"> = {
  code: "PROMOTED_AWAITING",
  order: 1,
  appliesTo: "held",
  entry: "row",
  guidance: "",
  rule: (stock, book, now) => {
    const { promoted } = stockFacts(stock, book, now);
    return promoted ? { active: true, data: { flag: promoted } } : { active: false };
  },
};
