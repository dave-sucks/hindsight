/**
 * The protection playbook (docs/plans/AGENT_ARCHITECTURE.md, 10.5 row 6).
 *
 * Written once from the morning run's two bullets it replaced: a holding
 * whose floor lags its gain (UNPROTECTED_GAIN) and a holding whose floor
 * would lose too much of the account (FLOOR_TOO_FAR, which a run answers even
 * when another flag leads the row: the brief then carries it as floorRisk).
 * The trigger run's "hold still means protecting the gain" went into the
 * add-or-winner playbook. Neither situation is a trigger, so a trigger run
 * never carries this one.
 *
 * Cap: 1,200 characters. A line added means a line removed.
 */
import type { Playbook } from "./types";

const TEXT = `When: a holding's floor locks in far less than its gain, so the gain can round-trip with no signal on the way down; or its floor would lose more than 1.5% of the account from what we paid (a buy is sized to lose about 1%). The flag carries the numbers.

Answer, in order:
1. What does the floor lock in, and what would it lose? The flag and the protection line give the numbers.
2. Where is real structure? The 20-day low, a swing low, the breakout level, an average (get_stock_data).

What you can do:
- Raise the floor under that structure: update_thesis with stop_loss, or manage_position update_targets. Tightening is always allowed. A compounder breathes wider than a trade.
- Or protect by taking: manage_position partial_close so the loss at the floor fits, or close_position when the structure is breaking or the reward is gone.
- Or say in one sentence why this floor stands and why the risk is worth it (a binary event this week that any trail would shake out).

Answered: the floor raised, a trim or a sale, or that sentence. "The business is intact" says whether to own it, not how much it can lose.

Mistakes:
- A round number, or a floor set at the entry by reflex.`;

const KINDS = new Set(["UNPROTECTED_GAIN", "FLOOR_TOO_FAR"]);

export const protection: Playbook = {
  key: "protection",
  cap: 1_200,
  text: TEXT,
  /** A held stock whose lead flag is an unprotected gain or a floor too far, or whose floor's risk rides beside another lead. */
  appliesToRow: (row) => {
    if (row.status !== "HOLDING") return false;
    const kind = (row.needsAction as { kind?: string } | null | undefined)?.kind;
    if (kind && KINDS.has(kind)) return true;
    return (row.resolved as { floorRisk?: unknown } | null | undefined)?.floorRisk != null;
  },
  appliesToFire: () => false,
};
