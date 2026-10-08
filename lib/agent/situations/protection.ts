/**
 * A holding's protection: its floor locks in far less than its gain
 * (UNPROTECTED_GAIN), or would lose too much of the account (FLOOR_TOO_FAR,
 * and the floor's risk with the stock named, which lists a stock even when a
 * fired sale holds the lead). Rule: work-flag.ts `unprotectedGainFlag` and
 * `floorTooFarFlag`, and the floor-risk check the resolver made (./facts.ts).
 */
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 protection text (9e323ec9). Cap 1,200 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: a holding's floor locks in far less than its gain, so the gain can round-trip with no signal on the way down; or its floor would lose more than 1.5% of the account from what we paid (a buy is sized to lose about 1%). The row carries the numbers.

Answer, in order:
1. What does the floor lock in, and what would it lose? The row gives the gain, what the floor locks in, and the loss at the floor.
2. Where is real structure? The 20-day low, a swing low, the breakout level, an average (get_stock_data).

What you can do:
- Raise the floor under that structure: update_thesis with stop_loss. Tightening is always allowed. A compounder breathes wider than a trade.
- Or protect by taking: manage_position partial_close so the loss at the floor fits, or close_position when the structure is breaking or the reward is gone.
- Or say in one sentence why this floor stands and why the risk is worth it (a binary event this week that any trail would shake out).

Answered: the floor raised, a trim or a sale, or that sentence. "The business is intact" says whether to own it, not how much it can lose.

Mistakes:
- A round number, or a floor set at the entry by reflex.`;

export const protection: SituationDefinition<"PROTECTION"> = {
  code: "PROTECTION",
  order: 9,
  appliesTo: "held",
  entry: "row",
  guidance: GUIDANCE,
  // Each of its three sources lists the stock: the two flags, and the floor risk on its own.
  lists: () => true,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const floorRisk = facts.floorRisk;
    if (!facts.floorTooFar && !facts.unprotectedGain && !floorRisk) return { active: false };
    return {
      active: true,
      data: {
        // FLOOR_TOO_FAR ranks above UNPROTECTED_GAIN (work-flag.ts).
        flag: facts.floorTooFar ?? facts.unprotectedGain ?? undefined,
        ...(facts.floorTooFar ? { floorTooFar: facts.floorTooFar } : {}),
        ...(facts.unprotectedGain ? { unprotectedGain: facts.unprotectedGain } : {}),
        ...(floorRisk ? { floorRisk } : {}),
      },
    };
  },
};
