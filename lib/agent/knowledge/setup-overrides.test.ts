/**
 * setup-overrides.test.ts — the playbook's numbers as settings (DAV-273).
 * A changed number changes what the sale is held to; an empty map is the
 * catalog as written; malformed rows are dropped. The chase limit, the
 * partial, the time limit and the beat-and-fade switch are templates now.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { applySetupOverride, parseSetupOverrides, setupNumbers } from "./setup-overrides";
import { getSetup, setupsForAnalyst } from "./setups";
import { validateThesisDecision } from "@/lib/agent/thesis-research/decision";

describe("applySetupOverride", () => {
  it("an empty map is the catalog as written", () => {
    const pead = getSetup("PEAD")!;
    expect(getSetup("PEAD", {})).toEqual(pead);
    expect(setupNumbers(pead)).toEqual({ stopMaxPct: 8, minAtr: 1 });
  });
  it("a number a template now carries is not an override", () => {
    expect(parseSetupOverrides({ PEAD: { partialAtR: 3 }, COMPOUNDER_ACCUMULATION: { minAtr: 2 } })).toEqual({ COMPOUNDER_ACCUMULATION: { minAtr: 2 } });
  });
  it("a trade stop cap is the sale's (place_trade, place-trade.sale-rules.replay.test.ts): the Writer's watch line is held to none", () => {
    const decision = {
      direction: "LONG" as const, horizon: "TRADE" as const, setup_id: "PEAD" as const,
      rationale: "A drift trade with a 10% stop under the gap-day low.",
      triggers: [
        { predicate: { watch: "price", is: "above", value: 100 }, action: "ENTER", rationale: "The buy at $100." },
        { predicate: { watch: "price", is: "below", value: 90, settings: { close: true } }, action: "STOP_WATCHING", rationale: "under the gap-day low $90.10, 1.8 ATR" },
        { predicate: { watch: "price", is: "above", value: 125 }, action: "REVIEW", rationale: "prior high $125, 2.5R" },
      ] as never,
      core_belief: "Drift to $125 in 30 days on the guide raise.", key_assumptions: ["a", "b"], invalidation_conditions: ["c", "d"],
      scoring: { trendStrength: { score: 2, note: "x" }, relativeStrength: { score: 2, note: "x" }, entryQuality: { score: 2, note: "x" }, catalystFreshness: { score: 2, note: "x" } },
      conviction: "MEDIUM" as const, conviction_rationale: "Honest middle; the guide raise is real and the stop is under structure.",
    };
    const asWritten = validateThesisDecision(decision, { mode: "mint", setups: setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]) });
    expect(asWritten.errors).toEqual([]);
    expect(getSetup("PEAD", { PEAD: { stopMaxPct: 12 } })!.stop.maxPct).toBe(12);
  });
  it("null clears a cap; a malformed row is dropped, the rest kept", () => {
    expect(getSetup("PEAD", { PEAD: { stopMaxPct: null } })!.stop.maxPct).toBeNull();
    expect(parseSetupOverrides({ PEAD: { minAtr: 2 }, MA_PULLBACK: { minAtr: "lots" } })).toEqual({ PEAD: { minAtr: 2 } });
    expect(parseSetupOverrides(null)).toEqual({});
  });
});
