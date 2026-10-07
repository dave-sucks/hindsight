/**
 * The stale-research playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 7).
 *
 * Written once from the morning run's stale-research bullet. One duty, two
 * sources: the lead flag (RESEARCH_STALE), or old research on any other row
 * the run reviews (the brief carries `researchAge` then). The trigger run
 * acts on its fire and leaves the refresh to the morning run (its kickoff
 * says so), so a trigger run never carries this one.
 *
 * Cap: 900 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";

const TEXT = `When: the research behind a committed view is older than its horizon allows, or missing. The row gives the age and the limit. On a watched stock the next thing to happen could be a buy on it.

Answer, in order:
1. Does the old work still stand against today's data?

What you can do:
- Refresh it (the default): dispatch_thesis_research with mode refresh, then wait_for_thesis_refresh, then re-read the stock and change its levels or conviction if the new work changed your view.
- Re-affirm it: update_thesis saying in one concrete sentence why it still stands ("the backlog case is unchanged; Q2 confirmed it").
- Stop paying for it: drop the review clock, and the plan's triggers too if the plan is dead.

Answered: a refresh, or one of the other two. A held stock owes the same, with more at stake.

Mistakes:
- "Looks fine", or a line you could have written without opening the stock.`;

export const staleResearch: Playbook = {
  key: "stale-research",
  cap: 900,
  text: TEXT,
  /** A committed view whose research is stale or missing: the lead flag, or on any listed row. */
  appliesToRow: (row) => {
    if (row.direction == null) return false;
    if ((row.needsAction as { kind?: string } | null | undefined)?.kind === "RESEARCH_STALE") return true;
    const f = row.researchAge?.freshness;
    return f === "stale" || f === "missing";
  },
  appliesToFire: () => false,
};
