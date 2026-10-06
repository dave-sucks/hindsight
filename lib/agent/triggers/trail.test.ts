/**
 * The armed trail (DAV-250): a TARGET position's 12% trail has no level
 * until the position has once been up 10%. The evaluator, the sheet's price
 * levels and the ratchet must all agree on that.
 */

import { trailFireLevel, trailOf } from "./trail";
import { evaluateTrigger, type EvaluationContext } from "./evaluate";
import { protectiveRatchetViolations } from "./ratchet";
import type { Trigger } from "./types";
import type { Condition, When } from "@/lib/agent/triggers/condition";

const armed12: Condition = { watch: "move", is: "below", value: 12, variable: "peak", settings: { startOnceUpPct: 10 } };

const ctx = (price: number, peak: number): EvaluationContext => ({
  thesis: { createdAt: new Date("2026-09-01"), direction: "LONG" },
  now: new Date("2026-09-11"),
  latestQuote: { price, changePct: -1 },
  position: { avgCost: 100, peakPrice: peak },
});

describe("trailFireLevel", () => {
  it("has no level before the peak clears the arming gain", () => {
    expect(trailFireLevel(trailOf(armed12), { peak: 109, avgCost: 100, isLong: true })).toBeNull();
  });
  it("draws the line once armed", () => {
    expect(trailFireLevel(trailOf(armed12), { peak: 120, avgCost: 100, isLong: true })).toBeCloseTo(105.6);
  });
  it("an unarmed-by-design trail (no armAtGainPct) is live from the first peak", () => {
    expect(trailFireLevel(trailOf({ watch: "move", is: "below", value: 8, variable: "peak" }), { peak: 101, isLong: true })).toBeCloseTo(92.92);
  });
  it("SHORT arms on the low-water mark", () => {
    expect(trailFireLevel(trailOf(armed12), { peak: 91, avgCost: 100, isLong: false })).toBeNull();
    expect(trailFireLevel(trailOf(armed12), { peak: 85, avgCost: 100, isLong: false })).toBeCloseTo(95.2);
  });
});

describe("evaluateTrigger — the armed trail", () => {
  it("does not fire on a 12% give-back from a +5% peak (never armed)", () => {
    // Peak 105 → 12% give-back is 92.4. Below it, but the trail never armed:
    // the floor is what governs a position that hasn't earned a gain.
    expect(evaluateTrigger(armed12, ctx(92, 105))).toBe(false);
  });
  it("fires on a 12% give-back once the position had been up 10%", () => {
    expect(evaluateTrigger(armed12, ctx(105.5, 120))).toBe(true);
    expect(evaluateTrigger(armed12, ctx(106, 120))).toBe(false);
  });
});

describe("the ratchet — arming later is a loosening", () => {
  const rung = (p: When): Trigger => ({ id: "t", predicate: p, action: "EXIT", rationale: "trail" });
  it("raising armAtGainPct is refused for an agent", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [rung(armed12)],
      after: [rung({ ...armed12, settings: { startOnceUpPct: 20 } })],
      inherited: [],
    });
    expect(v.map((x) => x.reason)).toEqual(["LOWERED"]);
  });
  it("adding an arm to a live trail is refused for an agent", () => {
    const v = protectiveRatchetViolations({
      direction: "LONG",
      before: [rung({ watch: "move", is: "below", value: 12, variable: "peak" })],
      after: [rung(armed12)],
      inherited: [],
    });
    expect(v.map((x) => x.reason)).toEqual(["LOWERED"]);
  });
});
