/**
 * setup-overrides.test.ts — the playbook's numbers as settings (DAV-273).
 * A changed number changes what the next fill writes and what the writer
 * checks; an empty map is the catalog as written; malformed rows are dropped.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { applySetupOverride, parseSetupOverrides, setupNumbers } from "./setup-overrides";
import { getSetup, setupsForAnalyst } from "./setups";
import { setupExitTriggers } from "@/lib/agent/triggers/setup-exits";
import { validateThesisDecision } from "@/lib/agent/thesis-research/decision";

let n = 0;
const mintId = () => `t${++n}`;

describe("applySetupOverride", () => {
  it("an empty map is the catalog as written", () => {
    const pead = getSetup("PEAD")!;
    expect(getSetup("PEAD", {})).toEqual(pead);
    expect(setupNumbers(pead)).toEqual({ stopMaxPct: 8, minAtr: 1, chaseLimitPct: 10, targetMinR: 2, partialAtR: 2, beatAndFadeReview: true, timeTradingDays: 60, riskMultiplier: 1 });
  });
  it("a changed partial changes what IOT's fill writes: 3R on a 7.76% stop is +23.3%", () => {
    const pead = getSetup("PEAD", { PEAD: { partialAtR: 3, timeTradingDays: 45 } })!;
    const out = setupExitTriggers({ setup: pead, horizon: "TARGET", entry: 39.83, stop: 36.74, mintId });
    expect(out[0].predicate).toEqual({ kind: "REVIEW_CADENCE", days: 45, from: "BUY" });
    // The partial also carries the big-winner switch (DAV-294): a changed R
    // multiple changes the level, not the rule that a runner is not trimmed.
    expect(out[1].predicate).toEqual({ kind: "GAIN_FROM_ENTRY", pct: 23.3, direction: "UP", skipIfPeakGainPct: 20 });
  });
  it("a widened trade stop cap changes what the writer accepts", () => {
    const decision = {
      direction: "LONG" as const, horizon: "TRADE" as const, setup_id: "PEAD" as const,
      rationale: "A drift trade with a 10% stop under the gap-day low.",
      entry_price: 100, stop_loss: 90, target_price: 125,
      stop_basis: "under the gap-day low $90.10, 1.8 ATR", target_basis: "prior high $125, 2.5R",
      core_belief: "Drift to $125 in 30 days on the guide raise.", key_assumptions: ["a", "b"], invalidation_conditions: ["c", "d"],
      scoring: { trendStrength: { score: 2, note: "x" }, relativeStrength: { score: 2, note: "x" }, entryQuality: { score: 2, note: "x" }, catalystFreshness: { score: 2, note: "x" } },
      conviction: "MEDIUM" as const, conviction_rationale: "Honest middle; the guide raise is real and the stop is under structure.",
    };
    const chart = { atr14: 5.5, pivot: null, brokenOut: null, daysSinceReport: 2 };
    const asWritten = validateThesisDecision(decision, { mode: "mint", setups: setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]), chart });
    expect(asWritten.errors.some((e) => e.includes("caps the stop at 8%"))).toBe(true);
    const widened = validateThesisDecision(decision, { mode: "mint", setups: setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"], { PEAD: { stopMaxPct: 12 } }), chart });
    expect(widened.errors).toEqual([]);
  });
  it("null clears a cap; a malformed row is dropped, the rest kept", () => {
    expect(getSetup("PEAD", { PEAD: { stopMaxPct: null } })!.stop.maxPct).toBeNull();
    expect(parseSetupOverrides({ PEAD: { partialAtR: 3 }, MA_PULLBACK: { partialAtR: "lots" } })).toEqual({ PEAD: { partialAtR: 3 } });
    expect(parseSetupOverrides(null)).toEqual({});
  });
});
