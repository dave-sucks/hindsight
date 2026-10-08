/**
 * A review: the review clock came due (work-flag.ts `reviewDueFlag`, not a
 * seed's first), or a review trigger fired or is true now that no other
 * situation claims; and every fire nothing else claims (QB ruling,
 * 2026-10-07), so no fire leaves the list.
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 default-review text (9e323ec9); the setup ask is NO_SETUP_NAMED's
 * now. Cap 2,000 characters (situations.guidance.test.ts); a line added
 * means a line removed. Not sent to any agent yet: the read that carries it
 * with the stock is a later change, which also takes the matching text out
 * of the prompts.
 */
const GUIDANCE = `When: the review clock came due on a LONG or SHORT stock, or a review trigger fired or is true now and no other situation covers it.

Answer, in order:
1. Has the principal said something not yet answered? It is in what's been said; answer it first.
2. Has the belief broken? On a stock you hold, go down the invalidation conditions and say for each whether it has happened. Price being down is not on the list unless you wrote it there.
3. Is the setup still working? Its failure signs (a close back under the level, fading volume, a beat the market sold), its manage rule, its time limit.
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

export const reviewDue: SituationDefinition<"REVIEW_DUE"> = {
  code: "REVIEW_DUE",
  order: 11,
  appliesTo: "both",
  entry: "row",
  guidance: GUIDANCE,
  lists: () => true,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const items = itemsFor(facts, "REVIEW_DUE");
    const clock = facts.clock?.kind === "REVIEW_DUE" && facts.clock.pendingFirstReview !== true ? facts.clock : null;
    if (items.length === 0 && !clock) return { active: false };
    return {
      active: true,
      data: {
        // A fire or match ranks above the clock (work-flag.ts).
        flag: firstFlag(items) ?? clock ?? undefined,
        fires: items.map((i) => i.ref),
        ...(clock ? { clock } : {}),
      },
    };
  },
};
