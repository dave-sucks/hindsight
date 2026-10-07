/**
 * The quiet-watch playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 9).
 *
 * Written once from the morning run's no-clock wake bullet. A watch with no
 * clock is a stock with no direction that carries only the wakes an analyst
 * set: a finished "not buying, keeping an eye on it". It never comes due on
 * a schedule; it comes back when a wake fires, and that is when this
 * attaches. Its sister, a seed awaiting first research, has no direction too
 * but comes due on its clock (first-research).
 *
 * Shares a 1,800-character cap with first-research.
 */
import type { Playbook } from "./types";
import { measuresOf } from "./attach";

const TEXT = `When: a trigger fired on a watch with no clock: no direction, no plan, no review schedule, only wakes you set. It asks one question: do you want this stock back?

Answer, in order:
1. What changed since you set the wake? Check with get_stock_data.

What you can do (one of these):
- Bring it back: update_thesis committing the full view (direction, horizon, prices, belief, assumptions, invalidation conditions, triggers), as a first research does.
- Re-arm it: update_thesis with edit_triggers moving the wakes to the levels that matter now. Add a review clock (add_triggers watching "repeat") only if the stock has earned one, and say why.
- Let it go: update_thesis with change_status ARCHIVED.

Answered: one of the three. A note that changes nothing lets the same wake fire again tomorrow.

Mistakes:
- Deciding the same wake again every day.`;

export const quietWatch: Playbook = {
  key: "quiet-watch",
  cap: 850,
  text: TEXT,
  /** A watched stock with no direction whose lead flag is a fire, and no review clock of its own. */
  appliesToRow: (row) => {
    if (row.status !== "WATCHING" || row.direction != null) return false;
    const kind = (row.needsAction as { kind?: string } | null | undefined)?.kind;
    if (kind !== "TRIGGER_FIRED" && kind !== "TRIGGER_MATCHING_NOW") return false;
    const own = (row.triggers ?? []) as Array<{ predicate?: unknown }>;
    return !own.some((t) => measuresOf(t.predicate).includes("repeat"));
  },
  appliesToFire: () => false,
};
