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

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 buy-arrives text (9e323ec9); a buy into a full analyst is
 * BUY_BLOCKED_FULL's now. Cap 2,500 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: a buy trigger fired or is true now on a stock we watch, or its buy level has been reached, and the analyst has room.

Answer, in order:
1. Does the price still hold the level? Check with get_stock_data. If it touched and slipped back, say so ("it hit $X, then slipped back to $Y").
2. Did the setup's own confirmation happen? The stock's setup says what confirms a buy and its chase limit. A breakout needs a close above the level on the volume its setup names; a pullback needs the touch to hold (a close above the prior day's high); an earnings gap needs the gap to hold; a compounder needs the thesis intact; a pre-catalyst buy is never the day before the event. With no setup named, the price holding is the confirmation. Outside market hours, leave volume out.
3. Is it chased, more than the chase limit past the level?
4. Does a headline from the last hour contradict it (get_stock_data's news)? A buy into bad news is a fade, not a breakout.
5. Did the principal decline this same buy, with nothing they named changed since? Then say so and pass.
6. Does the view still hold? A LOW-conviction buy is skipped unless another signal confirms it (volume, peer leadership). On a STRONG or HIGH thesis, defer if today's evidence breaks the variant view.

What you can do:
- Buy: place_trade (it sizes the buy), then one update_thesis saying why.
- Re-price: update_thesis with edit_triggers on the buy's id, at a level from the chart's structure (a new pivot, the average a pullback should touch), named in the rationale.
- Set the plan down: update_thesis with remove_trigger_ids naming the buy, floor and target, keeping a review, and one sentence on what made this not the entry.
- Stop watching: update_thesis with change_status ARCHIVED; INVALIDATED only when the thesis should not exist for you at all.

Answered: place_trade, a re-priced buy, or the plan set down. A chased or unconfirmed buy is re-priced to the next structure or set down, not bought and not left as a note. While the price holds the level a note alone is not the answer: a buy left as a note comes back on the next morning run as a plan check or a live match. A note does answer a buy whose price has slipped back.

Mistakes:
- Calling place_trade after a check failed.
- Volume as the reason on a pullback, a compounder or a pre-catalyst buy, or before mid-session.
- Moving the buy above the price to dodge it: it comes back the next day as a plan check, with the count.`;

export const buyArrives: SituationDefinition<"BUY_ARRIVES"> = {
  code: "BUY_ARRIVES",
  order: 3,
  appliesTo: "watched",
  entry: "row",
  guidance: GUIDANCE,
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
