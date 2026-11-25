/**
 * Thesis belief validation: the fields a LONG or SHORT thesis must carry.
 *
 * Used by `record_thesis` (write-time gate). The rule, said once:
 *   LONG / SHORT: core_belief (not empty) and kpis (two or more lines).
 *   PASS and an unresearched seed: no belief contract here.
 *
 * Why: without a belief and the KPIs that test it, a look can't tell whether
 * news or a fired trigger touches the reason we own the stock, and the trade
 * evaluator can't grade a closed trade against what we claimed.
 */

export interface ThesisBeliefArgs {
  // `null` is the unresearched-seed sentinel; it bypasses the belief gate.
  direction: "LONG" | "SHORT" | "PASS" | null;
  coreBelief?: string | null;
  kpis?: string[] | null;
}

export type ThesisBeliefResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-structural-belief-fields";
      note: string;
      missingFields: Array<"core_belief" | "kpis">;
    };

const GUIDANCE = [
  "A LONG or SHORT thesis needs its belief and its KPIs.",
  "",
  "• core_belief: why the business is worth owning and what has to stay true, in two or three plain sentences. About the business, never a stock price.",
  "• kpis: two to four lines, each a number the company reports or a named event, with the reading that says we are on track, the reading that says we are wrong, and when it is read.",
].join("\n");

export function validateThesisBelief(args: ThesisBeliefArgs): ThesisBeliefResult {
  if (args.direction === "PASS" || args.direction == null) return { ok: true };

  const coreBelief = (args.coreBelief ?? "").trim();
  const kpis = (args.kpis ?? []).filter((s) => typeof s === "string" && s.trim().length > 0);

  const missing: Array<"core_belief" | "kpis"> = [];
  if (coreBelief.length === 0) missing.push("core_belief");
  if (kpis.length < 2) missing.push("kpis");

  if (missing.length === 0) return { ok: true };

  return {
    ok: false,
    reason: "missing-structural-belief-fields",
    note: `Missing: ${missing.join(", ")}.\n\n${GUIDANCE}`,
    missingFields: missing,
  };
}
