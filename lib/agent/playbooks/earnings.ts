/**
 * The earnings playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 4).
 *
 * Written once from the two copies it replaced: the morning run's
 * earnings-review block and the trigger run's earnings bullet. It attaches
 * when the fired trigger watches a report date or a surprise; the figures
 * ride on the fire. The writer's own earnings guidance is the writer's and
 * stays there.
 *
 * Cap: 1,200 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";
import { leadWatches, measuresOf } from "./attach";

const MEASURES = ["report", "surprise"] as const;

const TEXT = `When: an earnings trigger fired: a report is near or came in.

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

export const earnings: Playbook = {
  key: "earnings",
  cap: 1_200,
  text: TEXT,
  /** The row's lead flag is a fire or match of a trigger watching a report date or a surprise. */
  appliesToRow: (row) => leadWatches(row, MEASURES),
  appliesToFire: ({ predicate }) => measuresOf(predicate).some((m) => (MEASURES as readonly string[]).includes(m)),
};
