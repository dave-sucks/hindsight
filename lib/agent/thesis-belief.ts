/**
 * Thesis belief validation — required structural-belief fields for
 * directional (LONG/SHORT) theses.
 *
 * Used by `record_thesis` (write-time gate) and `update_thesis` (when the
 * patch tries to substantively change a thesis without touching the
 * underlying belief, the agent must explicitly justify why the belief
 * still holds).
 *
 * Why this gate exists. 2026-05-07 audit: 32% / 32% / 38% population for
 * coreBelief / keyAssumptions / invalidationConds across 53 open theses.
 * EV Catalyst Trader: 0% on all three. The agent treats these as
 * optional even though they're load-bearing for tactical-run reasoning,
 * trade-evaluator post-mortems, and ThesisSheet's Plan rendering.
 *
 * Without a structured belief, a thesis is a paragraph of vibes —
 *   - the trade evaluator can't tell what the analyst was claiming,
 *   - the tactical agent can't decide whether a trigger fire actually
 *     invalidates the thesis vs is noise,
 *   - the daily run can't tell when an assumption flipped against us.
 *
 * Rules per direction:
 *   LONG / SHORT — REQUIRES core_belief (≥1 char after trim) AND
 *                  key_assumptions (≥2 non-empty items) AND
 *                  invalidation_conditions (≥2 non-empty items).
 *   PASS         — no belief contract at this layer. PASS is "researched,
 *                  decided not to trade" — the rationale lives in
 *                  reasoning_summary + thesis_bullets + risk_flags. Future
 *                  tightening could require invalidationConds on PASS as
 *                  flip-criteria; not in scope today.
 */

export interface ThesisBeliefArgs {
  direction: "LONG" | "SHORT" | "PASS" | "PENDING";
  coreBelief?: string | null;
  keyAssumptions?: string[] | null;
  invalidationConds?: string[] | null;
}

export type ThesisBeliefResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-structural-belief-fields";
      note: string;
      missingFields: Array<
        "core_belief" | "key_assumptions" | "invalidation_conditions"
      >;
    };

const GUIDANCE = [
  "Directional theses (LONG/SHORT) require a structured belief, not just a trade rationale.",
  "",
  "• core_belief — ONE sentence stating WHAT you believe will happen and why (e.g. \"AI capex sustains $200B/quarter through 2026, driving NVDA's gross margin above 75%\"). Distinct from reasoning_summary (which describes the trade and refreshes often); core_belief is the durable claim that, if it stops being true, the thesis is broken.",
  "• key_assumptions — ≥2 specific premises that MUST remain true for the core_belief to hold (e.g. \"datacenter capex stays above $200B/yr through 2027\", \"no breakup of NVDA's preferred customer relationship\"). Each item must be a single checkable claim — generic prose like \"strong fundamentals\" is insufficient.",
  "• invalidation_conditions — ≥2 specific, concrete things that would PROVE the thesis wrong (e.g. \"guidance cut on next print\", \"gross margin below 70% on next print\", \"CFO departure\"). These drive the tactical agent's \"is this trigger fire actually thesis-breaking?\" judgment. Generic risks like \"market downturn\" are insufficient.",
].join("\n");

export function validateThesisBelief(
  args: ThesisBeliefArgs,
): ThesisBeliefResult {
  // PASS + PENDING theses bypass the gate. PASS is "researched, decided
  // not to trade" — narrative is in reasoning_summary + risk_flags.
  // PENDING is "seed, awaiting first research" — the structural belief
  // is built when update_thesis promotes PENDING → LONG/SHORT.
  if (args.direction === "PASS" || args.direction === "PENDING") {
    return { ok: true };
  }

  const coreBelief = (args.coreBelief ?? "").trim();
  const keyAssumptions = (args.keyAssumptions ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0,
  );
  const invalidationConds = (args.invalidationConds ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0,
  );

  const missing: Array<
    "core_belief" | "key_assumptions" | "invalidation_conditions"
  > = [];
  if (coreBelief.length === 0) missing.push("core_belief");
  if (keyAssumptions.length < 2) missing.push("key_assumptions");
  if (invalidationConds.length < 2) missing.push("invalidation_conditions");

  if (missing.length === 0) return { ok: true };

  return {
    ok: false,
    reason: "missing-structural-belief-fields",
    note: `Missing: ${missing.join(", ")}.\n\n${GUIDANCE}`,
    missingFields: missing,
  };
}
