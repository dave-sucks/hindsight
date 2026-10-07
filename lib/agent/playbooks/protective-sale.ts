/**
 * The protective-sale playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 1).
 *
 * Written once from the text it replaced: the morning run's fired-sale
 * bullet and its held-through-the-floor duty, the trigger run's
 * belief-survived line, its tracked-peak paragraph and its two-sales line,
 * and the declined-sale line complete_run shows. The arithmetic of a fire
 * (the fire line, the tracked high) stays with the fire; this is what to do
 * with it.
 *
 * Cap: 1,500 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";

const TEXT = `When: a sale trigger fired on a stock we hold, or the principal declined that sale and the price is still past the line.

Answer, in order:
1. Is the price past the line now? Check with get_stock_data. A give-back counts from the tracked high, kept over the whole holding; a high read off a chart window is not grounds to call the fire false.
2. Did the principal decline it? Their words are in what's been said; the declined-sale flag has the count and the recent low.

What you can do:
- Sell: close_position with reason STOP, answering belief_survived as its description says; then one update_thesis saying why.
- After a decline, propose the sale again with today's reasons; a sale asks every day its condition holds. Say which day of the breach it is, quote their note, and offer the recent low as a level for the line.
- Or re-draw the line: update_thesis with edit_triggers on the fired trigger's id, as a price under structure you name, and say when you will look again. A declined line may come down at most 15%; nothing else may be loosened.
- Two sale triggers fired together: one decision covers both (sell all, some or none); name the rule you followed.

Answered: close_position, or the line re-drawn with update_thesis. A review that changes nothing is no answer.

Mistakes:
- Calling the fire false with a different high; declining a sale takes new evidence about the business.
- Going quiet after a decline.
- Removing a protective trigger or widening a trail: the save refuses both.`;

export const protectiveSale: Playbook = {
  key: "protective-sale",
  cap: 1_500,
  text: TEXT,
  /** A held stock whose lead flag is a declined sale, or a fired or matching sale. */
  appliesToRow: (row) => {
    if (row.status !== "HOLDING") return false;
    const lead = row.needsAction as { kind?: string; action?: string } | null | undefined;
    if (lead?.kind === "SALE_DECLINED") return true;
    return (lead?.kind === "TRIGGER_FIRED" || lead?.kind === "TRIGGER_MATCHING_NOW") && lead.action === "EXIT";
  },
  /** A sale fired on a stock we hold. */
  appliesToFire: ({ action, held }) => held && action === "EXIT",
};
