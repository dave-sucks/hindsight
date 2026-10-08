/**
 * An earnings trigger fired or is true now: the trigger watches a report date
 * or a surprise. Rule: the fires and matches whose condition watches `report`
 * or `surprise` (step-6 attach, 9e323ec9:lib/agent/playbooks/attach.ts).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: the step-6
 * earnings text (9e323ec9). Cap 1,200 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: an earnings trigger fired: a report is near or came in.

Answer, in order:
1. What do the figures say? The fire carries them: EPS and revenue against the street, the surprise, or the date and estimate. A surprise on an estimate under $0.05 is blank; judge it in dollars.
2. How did the stock take it? The reaction is the information. Read the call before trusting a number (get_earnings_data, web_search).

What you can do:
- Reports within days: sizing, not a trade. Held: sized for a 10% move either way? Trim, hold through, or set the floor where a bad print breaks the story. Watched: hold the buy until the report.
- Beat on both lines, guidance up: raise the target and floor; consider adding.
- EPS beat, revenue missed: the beat came from cost; raise nothing on it.
- A beat the stock is down on: the market wanted more; tighten the floor.
- A miss: a broken assumption is a sale (close_position, belief_survived false); an intact story that is early stays, floored under structure; say what would change your mind.

Answered: update_thesis naming the figures and what you did, or a trade.

Mistakes:
- Buying on a beat alone, or selling on a miss alone.
- Adding into the print.`;

export const earnings: SituationDefinition<"EARNINGS"> = {
  code: "EARNINGS",
  order: 6,
  appliesTo: "both",
  entry: "row",
  guidance: GUIDANCE,
  lists: () => true,
  rule: (stock, book, now) => {
    const items = itemsFor(stockFacts(stock, book, now), "EARNINGS");
    if (items.length === 0) return { active: false };
    return { active: true, data: { flag: firstFlag(items), fires: items.map((i) => i.ref) } };
  },
};
