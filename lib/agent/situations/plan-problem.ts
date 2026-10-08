/**
 * A watched plan contradicts the tape: any plan check (./plan-checks.ts),
 * each with its code and text, and the resolver's STALE_PAST_CATALYST label
 * (a dated event passed with nothing resolved; QB ruling, 2026-10-07).
 *
 * Listing, as today's read: every check lists the stock except "no buy
 * level" and "score under the minimum" on their own (decision 4 in
 * docs/plans/AGENT_ARCHITECTURE.md, approved 2026-10-02). A stock with no buy
 * price comes onto the list on its review clock or when a trigger fires, and
 * both checks still show whenever the stock is opened. A past catalyst lists
 * it.
 */
import { planChecks } from "./plan-checks";
import type { SituationDefinition } from "./types";

const CODES_THAT_DO_NOT_LIST = new Set(["NO_BUY_LEVEL", "COMPOSITE_BELOW_MINIMUM"]);

/** Whether one plan check lists the stock on its own. */
export function codeLists(kind: string): boolean {
  return !CODES_THAT_DO_NOT_LIST.has(kind);
}

/**
 * What an agent is told when the stock is in this situation: re-cut from the
 * step-6 plan-problems text (9e323ec9), with the past catalyst added. Cap
 * 1,200 characters (situations.guidance.test.ts); a line added means a line
 * removed. Not sent to any agent yet: the read that carries it with the
 * stock is a later change, which also takes the matching text out of the
 * prompts.
 */
const GUIDANCE = `When: a watched stock's plan contradicts the tape or the calendar: the buy level on the price or far from it, a target passed, a floor breached or inside the stock's ordinary daily move, a plan under 2:1, a score under the analyst's minimum, no buy level, nothing that can bring it back, or a dated event passed with nothing resolved. Each check on the row states its arithmetic.

Answer, in order:
1. What does each check on the row say? Read its numbers.

What you can do, for each check:
- Fix the number: update_thesis with the re-anchored level (edit_triggers on its id) and a rationale.
- Or say in one sentence why the level is deliberately parked where it is ("buy level stays $58: a crash-only entry by design, revisit after earnings").
- Or set the plan down: update_thesis with remove_trigger_ids naming the buy, target and floor triggers, and the review clock too if the stock no longer earns one. It stays on the watchlist costing nothing, with whatever wakes you keep.

Answered: one of the three for every check on the row. A review that does not mention a check leaves it there tomorrow, and every day after.

Mistakes:
- Re-anchoring to a round number instead of structure.`;

export const planProblem: SituationDefinition<"PLAN_PROBLEM"> = {
  code: "PLAN_PROBLEM",
  order: 13,
  appliesTo: "watched",
  entry: "row",
  guidance: GUIDANCE,
  lists: (data) => data.codes.some((c) => codeLists(c.kind)),
  rule: (stock) => {
    const codes: Array<{ kind: string; text: string | null }> = (stock.plan ? planChecks(stock.plan) : []).map((f) => ({
      kind: f.kind,
      text: f.text,
    }));
    if (stock.resolved?.actionability === "STALE_PAST_CATALYST") codes.push({ kind: "STALE_PAST_CATALYST", text: null });
    return codes.length ? { active: true, data: { codes } } : { active: false };
  },
};
