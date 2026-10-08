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

export const planProblem: SituationDefinition<"PLAN_PROBLEM"> = {
  code: "PLAN_PROBLEM",
  order: 13,
  appliesTo: "watched",
  entry: "row",
  guidance: "",
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
