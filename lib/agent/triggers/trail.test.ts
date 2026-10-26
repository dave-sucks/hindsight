/**
 * A trail is one number: N% off the high since we bought. The arming gain and
 * the range widening were deleted, so a stored trigger that still carries
 * either fires at its plain line, and the sheet draws that same line.
 */

import { trailFireLevel } from "./trail";
import { evaluateTrigger, type EvaluationContext } from "./evaluate";
import { protectiveRatchetViolations } from "./ratchet";
import type { Trigger } from "./types";
import type { Condition, When } from "@/lib/agent/triggers/condition";

const trail12: Condition = { watch: "move", is: "below", value: 12, variable: "peak" };
/** The PEAD seat's old trail, as a stored row still carries it. */
const storedOld: Condition = { ...trail12, settings: { startOnceUpPct: 10, widenAtr: 3 } };

const ctx = (price: number, peak: number): EvaluationContext => ({
  thesis: { createdAt: new Date("2026-09-01"), direction: "LONG" },
  now: new Date("2026-09-11"),
  latestQuote: { price, changePct: -1 },
  position: { avgCost: 100, peakPrice: peak },
  indicators: { atr14: 50 } as EvaluationContext["indicators"],
});

describe("trailFireLevel", () => {
  it("is N% off the high, from the first peak", () => {
    expect(trailFireLevel(12, { peak: 105, isLong: true })).toBeCloseTo(92.4);
    expect(trailFireLevel(8, { peak: 101, isLong: true })).toBeCloseTo(92.92);
  });
  it("SHORT: N% above the low", () => {
    expect(trailFireLevel(12, { peak: 85, isLong: false })).toBeCloseTo(95.2);
  });
  it("no tracked peak, no line", () => {
    expect(trailFireLevel(12, { peak: null, isLong: true })).toBeNull();
  });
});

describe("evaluateTrigger — a stored trail with the deleted keys", () => {
  it("fires on a 12% give-back from a +5% peak: no arming gain any more", () => {
    expect(evaluateTrigger(storedOld, ctx(92, 105))).toBe(true);
    expect(evaluateTrigger(trail12, ctx(92, 105))).toBe(true);
  });
  it("is not widened by the stock's range", () => {
    // 3× a $50 range on a $120 peak would have been 125%; the line is 12% off: $105.60.
    expect(evaluateTrigger(storedOld, ctx(105.5, 120))).toBe(true);
    expect(evaluateTrigger(storedOld, ctx(106, 120))).toBe(false);
  });
});

describe("the ratchet — a wider trail is still a loosening", () => {
  const rung = (p: When): Trigger => ({ id: "t", predicate: p, action: "EXIT", rationale: "trail" });
  it("12% → 15% is refused for an agent", () => {
    const v = protectiveRatchetViolations({ direction: "LONG", before: [rung(trail12)], after: [rung({ ...trail12, value: 15 })], inherited: [] });
    expect(v.map((x) => x.reason)).toEqual(["LOWERED"]);
  });
});
