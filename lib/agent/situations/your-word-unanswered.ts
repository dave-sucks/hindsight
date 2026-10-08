/**
 * The principal's decision or note no run has answered. Rule:
 * stock-context.ts `unansweredDecision` (a decision that wants an answer, or
 * a note written since the last answer).
 */
import type { SituationDefinition } from "./types";

export const yourWordUnanswered: SituationDefinition<"YOUR_WORD_UNANSWERED"> = {
  code: "YOUR_WORD_UNANSWERED",
  order: 14,
  appliesTo: "both",
  entry: "row",
  guidance: "",
  rule: (stock) =>
    stock.unansweredDecision ? { active: true, data: { decision: stock.unansweredDecision } } : { active: false },
};
