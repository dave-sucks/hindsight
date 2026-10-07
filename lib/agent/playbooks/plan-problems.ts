/**
 * The plan-problems playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 8).
 *
 * Written once from the morning run's plan-sanity paragraph. Each of the 13
 * plan flags (plan-sanity.ts) keeps its own arithmetic and its own answers
 * on the flag; this says what the run owes all of them.
 *
 * Cap: 1,200 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";

const TEXT = `When: a watched stock's plan contradicts the tape, and the row carries a plan flag: the buy level on the price or far from it, a target already passed, a floor already breached or inside the stock's ordinary daily move, a plan under 2:1, a score under the analyst's minimum, no buy level, or nothing that can bring it back. Each flag states its arithmetic and its answers.

Answer, in order:
1. What does each flag on the row say? Read its numbers.

What you can do, for each flag:
- Fix the number: update_thesis with the re-anchored level (edit_triggers on its id) and a rationale.
- Or say in one sentence why the level is deliberately parked where it is ("buy level stays $58: a crash-only entry by design, revisit after earnings").
- Or set the plan down: update_thesis with remove_trigger_ids naming the buy, target and floor triggers, and the review clock too if the stock no longer earns one. It stays on the watchlist costing nothing, with whatever wakes you keep.

Answered: one of the three for every flag on the row. A review that does not mention the flag leaves it there tomorrow, and every day after.

Mistakes:
- Re-anchoring to a round number instead of structure.`;

export const planProblems: Playbook = {
  key: "plan-problems",
  cap: 1_200,
  text: TEXT,
  /** The row carries any plan flag. */
  appliesToRow: (row) => {
    const flags = (row.resolved as { planSanity?: unknown[] | null } | null | undefined)?.planSanity;
    return Array.isArray(flags) && flags.length > 0;
  },
  appliesToFire: () => false,
};
