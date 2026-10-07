/**
 * The default-review playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5, the
 * default review). The most common path: 77 of 236 reviews in the month
 * measured said the plan stands.
 *
 * Written once from the morning run's fired-review bullet, its due-review
 * bullet, the held review's setup checklist, "every review re-earns the
 * ladder" and the review cadence. The trigger run keeps its belief anchor
 * and re-ladder duty in its system prompt, as the job for every fire, until
 * step 7, so this never rides on a fire.
 *
 * Attaches (ruling 2026-10-07) to a row whose lead is a review on a LONG or
 * SHORT, whatever else the row carries; and, in the morning read, to a
 * listed row no other playbook claims (index.ts). Not a seed's due review
 * (first-research) or a wake on a watch with no direction (quiet-watch).
 *
 * Cap: 2,000 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";

const TEXT = `When: a review is the lead on a LONG or SHORT stock (a review trigger fired or matches, or the review clock came due), or the stock is listed and no other playbook covers it.

Answer, in order:
1. Has the principal said something not yet answered? It is in what's been said; answer it first.
2. Has the belief broken? On a stock you hold, go down invalidationConds and say for each whether it has happened. Price being down is not on the list unless you wrote it there.
3. Is the setup still working? Its failure signs (a close back under the level, fading volume, a beat the market sold), its manage rule, its time limit. A row with nameTheSetup: name it now with setup_id, or "NONE" and why.
4. Did the world move past the levels? An add level blown through, a floor lagging the gain, a fired checkpoint never replaced, a target the street re-rated past.

What you can do:
- Patch the plan: update_thesis with edit_triggers on the levels that moved, by id.
- The plan stands: update_thesis with a rationale only, saying what you checked and why. Pass trigger_id when a review fired.
- Retune the clock: edit_triggers on the review clock's id (slower for a quiet name, faster into a catalyst), or remove it, keeping one level or move that can still fire.
- A condition that happened is an exit: close_position with belief_survived false.
- No longer applicable: change_status INVALIDATED.

Answered: one update_thesis on the stock. "The plan stands" is honest only when neither the story nor the levels moved.

Mistakes:
- The same answer to a review that fired again: change the plan, or say what differs from last time.
- Deleting a level you still believe in to look at the name less.`;

export const defaultReview: Playbook = {
  key: "default-review",
  cap: 2_000,
  text: TEXT,
  /** A review leads the row, on a LONG or SHORT. The unclaimed-row case is the registry's (index.ts). */
  appliesToRow: (row) => {
    if (row.direction !== "LONG" && row.direction !== "SHORT") return false;
    const lead = row.needsAction as { kind?: string; action?: string; pendingFirstReview?: boolean } | null | undefined;
    if (lead?.kind === "REVIEW_DUE") return lead.pendingFirstReview !== true;
    return (lead?.kind === "TRIGGER_FIRED" || lead?.kind === "TRIGGER_MATCHING_NOW") && lead.action === "REVIEW";
  },
  appliesToFire: () => false,
};
