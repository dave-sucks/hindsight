/**
 * The buy-arrives playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 2).
 *
 * Written once from the text it replaced: the trigger run's confirmation
 * gates and what a failed one means, its declined-buy line, and the morning
 * run's fired-buy bullet with re-pricing, its low-conviction buy line and its
 * variant-view line. Where the two disagreed, it says what happens: while
 * the price still holds the level, a note alone is not the answer to a fired
 * buy, and one left as a note comes back on the next morning run as a plan
 * flag or a live match (complete_run's fired-buy bar was deleted 2026-10-07;
 * the trigger run's text had said to pass with a note).
 *
 * Cap: 2,500 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";

const TEXT = `When: a buy trigger fired or is true now on a stock we watch.

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

Answered: place_trade, a re-priced buy, or the plan set down. A chased or unconfirmed buy is re-priced to the next structure or set down, not bought and not left as a note. While the price holds the level a note alone is not the answer: a buy left as a note comes back on the next morning run as a plan flag or live match. A note does answer two cases: a buy whose price has slipped back, and a buy fired into a full analyst: the one update its row or message asks for answers it.

Mistakes:
- Calling place_trade after a check failed.
- Volume as the reason on a pullback, a compounder or a pre-catalyst buy, or before mid-session.
- Moving the buy above the price to dodge it: it comes back the next day as a plan flag, with the count.`;

export const buyArrives: Playbook = {
  key: "buy-arrives",
  cap: 2_500,
  text: TEXT,
  /** A watched stock whose lead flag is a fired or matching buy, or whose buy level the price has reached. */
  appliesToRow: (row) => {
    if (row.status !== "WATCHING") return false;
    const lead = row.needsAction as { kind?: string; action?: string } | null | undefined;
    if ((lead?.kind === "TRIGGER_FIRED" || lead?.kind === "TRIGGER_MATCHING_NOW") && lead.action === "ENTER") return true;
    return (row.resolved as { actionability?: string } | null | undefined)?.actionability === "ENTER_NOW";
  },
  /** A buy fired on a stock we don't hold yet. */
  appliesToFire: ({ action, held }) => !held && action === "ENTER",
};
