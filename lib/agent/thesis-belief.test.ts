/**
 * thesis-belief.test.ts — coverage for validateThesisBelief.
 *
 * Pure function; no DB, no fetches. Walks the LONG / SHORT / PASS
 * branches with all-fields-set, partial, empty-string-noise, and
 * whitespace-only edge cases.
 */

import { validateThesisBelief } from "./thesis-belief";

describe("validateThesisBelief", () => {
  // ── PASS ───────────────────────────────────────────────────────────────

  it("PASS direction: any shape passes (gate doesn't apply)", () => {
    expect(
      validateThesisBelief({
        direction: "PASS",
        coreBelief: "",
        keyAssumptions: [],
        invalidationConds: [],
      }),
    ).toEqual({ ok: true });
  });

  it("PASS direction: missing fields entirely pass", () => {
    expect(validateThesisBelief({ direction: "PASS" })).toEqual({ ok: true });
  });

  // ── LONG happy path ────────────────────────────────────────────────────

  it("LONG with all three fields populated: ok", () => {
    expect(
      validateThesisBelief({
        direction: "LONG",
        coreBelief: "AI capex sustains through 2026.",
        keyAssumptions: ["Datacenter capex >$200B/yr", "No customer churn"],
        invalidationConds: ["Guidance cut", "Gross margin below 70%"],
      }),
    ).toEqual({ ok: true });
  });

  it("LONG with exactly 2 assumptions and 2 invalidations: ok", () => {
    const result = validateThesisBelief({
      direction: "LONG",
      coreBelief: "X",
      keyAssumptions: ["a", "b"],
      invalidationConds: ["c", "d"],
    });
    expect(result.ok).toBe(true);
  });

  // ── LONG failures ──────────────────────────────────────────────────────

  it("LONG missing all three: fails with all three flagged", () => {
    const result = validateThesisBelief({ direction: "LONG" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual([
      "core_belief",
      "key_assumptions",
      "invalidation_conditions",
    ]);
  });

  it("LONG with empty coreBelief string: fails on coreBelief", () => {
    const result = validateThesisBelief({
      direction: "LONG",
      coreBelief: "",
      keyAssumptions: ["a", "b"],
      invalidationConds: ["c", "d"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual(["core_belief"]);
  });

  it("LONG with whitespace-only coreBelief: fails on coreBelief", () => {
    const result = validateThesisBelief({
      direction: "LONG",
      coreBelief: "    \n  ",
      keyAssumptions: ["a", "b"],
      invalidationConds: ["c", "d"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual(["core_belief"]);
  });

  it("LONG with only 1 assumption: fails on key_assumptions", () => {
    const result = validateThesisBelief({
      direction: "LONG",
      coreBelief: "X",
      keyAssumptions: ["just one"],
      invalidationConds: ["c", "d"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual(["key_assumptions"]);
  });

  it("LONG with whitespace-only assumption items: fails on key_assumptions", () => {
    // Filtering rule: empty or whitespace-only strings don't count.
    const result = validateThesisBelief({
      direction: "LONG",
      coreBelief: "X",
      keyAssumptions: ["real", "  ", "", "  \t  "],
      invalidationConds: ["c", "d"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual(["key_assumptions"]);
  });

  it("LONG with only 1 invalidation: fails on invalidation_conditions", () => {
    const result = validateThesisBelief({
      direction: "LONG",
      coreBelief: "X",
      keyAssumptions: ["a", "b"],
      invalidationConds: ["just one"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual(["invalidation_conditions"]);
  });

  it("LONG missing two of three: flags both", () => {
    const result = validateThesisBelief({
      direction: "LONG",
      coreBelief: "X",
      keyAssumptions: [],
      invalidationConds: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual([
      "key_assumptions",
      "invalidation_conditions",
    ]);
  });

  // ── SHORT mirrors LONG ────────────────────────────────────────────────

  it("SHORT with all three: ok", () => {
    expect(
      validateThesisBelief({
        direction: "SHORT",
        coreBelief: "Margin compression coming.",
        keyAssumptions: ["Input costs rising", "No price power"],
        invalidationConds: ["Surprise margin expansion", "Pricing power confirmed"],
      }),
    ).toEqual({ ok: true });
  });

  it("SHORT missing all three: fails the same way as LONG", () => {
    const result = validateThesisBelief({ direction: "SHORT" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFields).toEqual([
      "core_belief",
      "key_assumptions",
      "invalidation_conditions",
    ]);
  });

  // ── Note formatting ────────────────────────────────────────────────────

  it("note includes which fields are missing", () => {
    const result = validateThesisBelief({
      direction: "LONG",
      coreBelief: "X",
      keyAssumptions: ["a"],
      invalidationConds: ["c", "d"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.note).toMatch(/Missing: key_assumptions/);
    expect(result.note).toMatch(/structured belief/);
  });
});
