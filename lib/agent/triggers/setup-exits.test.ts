/**
 * setup-exits.test.ts — what a fill writes onto the stock from its setup
 * (DAV-254). Replayed from IOT's 2026-09-14 fill: PEAD Specialist, TARGET,
 * 230 shares at $39.83 with the stop at $36.74 (7.76% away). Before this,
 * a fill wrote the horizon template and nothing from the setup: no partial,
 * no beat-that-sold review.
 */
import { setupExitTriggers, BEAT_AND_FADE_DOWN_PCT } from "./setup-exits";
import { getSetup } from "@/lib/agent/knowledge/setups";

let n = 0;
const mintId = () => `t${++n}`;

describe("setupExitTriggers", () => {
  it("IOT on PEAD: a partial at 2R (+15.5%) and the beat-that-sold review", () => {
    const out = setupExitTriggers({ setup: getSetup("PEAD")!, horizon: "TARGET", entry: 39.83, stop: 36.74, mintId });
    expect(out.map((t) => [t.action, t.predicate.kind])).toEqual([
      ["TRIM", "GAIN_FROM_ENTRY"],
      ["REVIEW", "AND"],
    ]);
    expect(out[0].predicate).toEqual({ kind: "GAIN_FROM_ENTRY", pct: 15.5, direction: "UP" });
    expect(out[1].predicate).toEqual({
      kind: "AND",
      predicates: [
        { kind: "EARNINGS_BEAT" },
        { kind: "PRICE_MOVE_PCT", pct: BEAT_AND_FADE_DOWN_PCT, direction: "DOWN", window: "1D" },
      ],
    });
    expect(out.every((t) => t.source === "DEFAULT")).toBe(true);
  });

  it("a compounder gets neither — its exits are the analyst's rules and a named invalidation", () => {
    const out = setupExitTriggers({ setup: getSetup("COMPOUNDER_ACCUMULATION")!, horizon: "COMPOUNDER", entry: 100, stop: 80, mintId });
    expect(out).toEqual([]);
  });

  it("a pullback on a TARGET horizon gets the beat-that-sold review but no partial", () => {
    const out = setupExitTriggers({ setup: getSetup("MA_PULLBACK")!, horizon: "TARGET", entry: 54.48, stop: 50.7, mintId });
    expect(out.map((t) => t.predicate.kind)).toEqual(["AND"]);
  });

  it("no stop → no partial (there is no R to measure)", () => {
    const out = setupExitTriggers({ setup: getSetup("PEAD")!, horizon: "TARGET", entry: 39.83, stop: null, mintId });
    expect(out.map((t) => t.predicate.kind)).toEqual(["AND"]);
  });
});
