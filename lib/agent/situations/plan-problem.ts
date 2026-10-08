/**
 * A watched plan contradicts the tape: any plan-sanity flag, each with its
 * code and text (plan-sanity.ts, read off the resolver), and the resolver's
 * STALE_PAST_CATALYST label (a dated event passed with nothing resolved; QB
 * ruling, 2026-10-07).
 */
import type { SituationDefinition } from "./types";

export const planProblem: SituationDefinition<"PLAN_PROBLEM"> = {
  code: "PLAN_PROBLEM",
  order: 13,
  appliesTo: "watched",
  entry: "row",
  guidance: "",
  rule: (stock) => {
    const codes: Array<{ kind: string; text: string | null }> = (stock.resolved?.planSanity ?? []).map((f) => ({
      kind: f.kind,
      text: f.text,
    }));
    if (stock.resolved?.actionability === "STALE_PAST_CATALYST") codes.push({ kind: "STALE_PAST_CATALYST", text: null });
    return codes.length ? { active: true, data: { codes } } : { active: false };
  },
};
