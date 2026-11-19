/**
 * decision.setup.test.ts — the setup the writer names is whatever it names.
 *
 * No check reads it (deleted 2026-11-16, each to come back if the app shows a
 * need): a decision may name no setup, a setup off the seat's list is
 * accepted as named, and a setup past its window is accepted. The save writes
 * the named playbook's watch triggers; the writer tailors them after it.
 *
 * Replayed from production: DOCU, minted 2026-09-09 15:37 UTC by the PEAD
 * Specialist (run cmtu9hxmc000004jvp5wbzvpz), stored setupId null; HPE,
 * refreshed 2026-09-15 (run cmu30r2u20002sky7xsjj9m2u) on PEAD 13 days after
 * the report, when PEAD's entry is days 1–3.
 */

import { validateThesisDecision, type ThesisDecisionInput } from "./decision";

const docu: ThesisDecisionInput = {
  direction: "LONG",
  horizon: "TARGET",
  rationale: "Post-earnings drift after a clean beat; buy a pullback toward the gap area rather than chase.",
  core_belief: "DOCU re-rates as IAM seat growth keeps billings above 8%.",
  key_assumptions: ["Billings growth stays above 8%", "Gross margin holds above 80%"],
  invalidation_conditions: ["Next-quarter billings guide below 6%", "Gross margin under 78% in the 10-Q"],
  conviction: "MEDIUM",
  conviction_rationale: "The beat was real and the stock held the gap, but the multiple already moved a lot.",
};

describe("DOCU 2026-09-09 — the real PEAD mint", () => {
  it("no setup named is accepted", () => {
    expect(validateThesisDecision(docu, { mode: "mint" })).toMatchObject({ ok: true, errors: [] });
  });

  it("naming PEAD is accepted", () => {
    expect(validateThesisDecision({ ...docu, setup_id: "PEAD" }, { mode: "mint" })).toMatchObject({ ok: true, errors: [] });
  });

  it("a setup this seat doesn't run is accepted as named", () => {
    const v = validateThesisDecision({ ...docu, setup_id: "BASE_BREAKOUT" }, { mode: "mint" });
    expect(v.ok).toBe(true);
    expect(v.decision?.setup_id).toBe("BASE_BREAKOUT");
  });
});

describe("HPE 2026-09-15 — a PEAD refresh 13 days after the report", () => {
  it("is accepted: PEAD's window closed on day 3 and nothing sends it back for that", () => {
    const v = validateThesisDecision(
      { ...docu, setup_id: "PEAD", rationale: "The Q3 print remains a clean PEAD trigger, but two overhead gap zones broke the stop; the thesis stays LONG and WATCHING unpriced." },
      { mode: "refresh", existingStatus: "WATCHING", currentPrice: 55.99 },
    );
    expect(v).toMatchObject({ ok: true, errors: [] });
  });
});
