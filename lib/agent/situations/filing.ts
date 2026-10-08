/**
 * A filing trigger fired or is true now: the trigger watches the stock's
 * filings. Rule: the fires and matches whose condition watches `filing`
 * (step-6 attach, 9e323ec9:lib/agent/playbooks/attach.ts).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 filings text (9e323ec9). Cap 1,200 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: a filing trigger fired or is true now. The fire names the kind of event and the link; the code names the class, the document names the direction.

Answer, in order:
1. What does the filing say? Read it first (get_sec_filings gives the link).
2. Do we hold the stock, or watch it?

What you can do, held:
- A restatement (4.02) means the numbers may be false: sell unless it is clearly small and off-thesis, and say which.
- Bankruptcy or a delisting notice: sell.
- A late report: find the stated reason, tighten the floor, add nothing until it is filed.
- An officer leaving (5.02): a planned succession is noise; a sudden CFO exit is a warning, so tighten the floor.
- We hold an acquisition target: the price is capped at the deal price; move the target to it and consider selling.
- Dilution (3.02, 424B5, S-3): add nothing into it; check the use of proceeds.
Watched: set the plan down on a restatement, stop watching on bankruptcy, buy nothing into a late report or an offering.

Answered: update_thesis citing the filing you read, or the trade.

Mistakes:
- Acting on the class without reading the document.`;

export const filing: SituationDefinition<"FILING"> = {
  code: "FILING",
  order: 7,
  appliesTo: "both",
  entry: "row",
  guidance: GUIDANCE,
  lists: () => true,
  rule: (stock, book, now) => {
    const items = itemsFor(stockFacts(stock, book, now), "FILING");
    if (items.length === 0) return { active: false };
    return { active: true, data: { flag: firstFlag(items), fires: items.map((i) => i.ref) } };
  },
};
