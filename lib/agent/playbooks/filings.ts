/**
 * The filings playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 5).
 *
 * Written once from the two copies it replaced: the morning run's
 * filing-review bullet and the trigger run's filing bullet. It attaches when
 * the fired trigger watches the stock's filings; the fire names the kind of
 * event and the link.
 *
 * Cap: 1,200 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";
import { leadWatches, measuresOf } from "./attach";

const MEASURES = ["filing"] as const;

const TEXT = `When: a filing trigger fired. The fire names the kind of event and the link; the code names the class, the document names the direction.

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

export const filings: Playbook = {
  key: "filings",
  cap: 1_200,
  text: TEXT,
  /** The row's lead flag is a fire or match of a trigger watching the stock's filings. */
  appliesToRow: (row) => leadWatches(row, MEASURES),
  appliesToFire: ({ predicate }) => measuresOf(predicate).some((m) => (MEASURES as readonly string[]).includes(m)),
};
