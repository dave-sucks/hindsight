/**
 * The first-research playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 10).
 *
 * Written once from the morning run's unresearched-seed bullet. A seed is a
 * stock put on the watchlist with no view yet; it comes due on its clock
 * (REVIEW_DUE with pendingFirstReview).
 *
 * Shares a 1,800-character cap with quiet-watch.
 */
import type { Playbook } from "./types";

const TEXT = `When: a seed is due its first research: a stock put on the watchlist with no view yet.

Answer, in order:
1. Is there a tradeable view? Pull get_stock_data and what else you need.

What you can do:
- Commit a view: update_thesis with direction LONG or SHORT, horizon, entry_price, target_price, stop_loss, core_belief, key_assumptions (two or more), invalidation_conditions (two or more), triggers and a rationale. It stays on watch with its buy trigger; the save refuses a commitment missing a structural field.
- Pass: update_thesis with direction PASS, invalidation_conditions (one or more) and a rationale. It leaves the watchlist and stays on the stock's page as a decision.

Answered: one of the two. A note with no direction leaves the seed where it is, to be asked again tomorrow.

Mistakes:
- Taking a watch with no clock for a seed: its wakes arrive as fires, and the quiet-watch playbook covers them.`;

export const firstResearch: Playbook = {
  key: "first-research",
  cap: 950,
  text: TEXT,
  /** A seed's first review is due. */
  appliesToRow: (row) => {
    const lead = row.needsAction as { kind?: string; pendingFirstReview?: boolean } | null | undefined;
    return lead?.kind === "REVIEW_DUE" && lead.pendingFirstReview === true;
  },
  appliesToFire: () => false,
};
