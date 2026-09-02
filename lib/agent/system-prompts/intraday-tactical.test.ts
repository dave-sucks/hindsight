/**
 * intraday-tactical.test.ts — the tracked-peak contract for trail fires
 * (DAV-186).
 *
 * A TRAILING_FROM_HIGH fire must hand the agent the system's remembered
 * peak (Position.peakPrice) and the exact fire line, and tell it the number
 * is authoritative — the HPE 2026-08-18 miss was the validating agent
 * re-deriving a "peak" from a short chart window and declining a genuine
 * protection alarm.
 */

import { buildTacticalSystemPrompt } from "./intraday-tactical";
import type { Trigger } from "@/lib/agent/triggers/types";

const trailTrigger: Trigger = {
  id: "trig_trail",
  predicate: { kind: "TRAILING_FROM_HIGH", pct: 12 },
  action: "EXIT",
  rationale: "Protect the gain.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeArgs(overrides: Record<string, any> = {}): any {
  return {
    analyst: { name: "PEAD Specialist", mandate: null },
    thesis: {
      id: "thesis_1",
      ticker: "HPE",
      direction: "LONG",
      horizon: "TARGET",
      coreBelief: "Belief.",
      keyAssumptions: ["a"],
      invalidationConds: ["b"],
      entryPrice: 53,
      targetPrice: 70,
      stopLoss: 50,
      targetSizePct: 3,
      snapshotText: null,
      bullCaseBullets: [],
      bearCaseBullets: [],
      researchAge: { freshness: "fresh", daysOld: 1, horizonThreshold: 7 },
      allTriggers: [trailTrigger],
    },
    trigger: trailTrigger,
    signal: null,
    position: { quantity: 60, avgCost: 53.1, daysHeld: 10, peakPrice: 62.7 },
    recentUpdates: [],
    latestDigest: null,
    ...overrides,
  };
}

describe("buildTacticalSystemPrompt — tracked peak on trail fires (DAV-186)", () => {
  it("hands the agent the tracked peak, the exact fire line, and the do-not-re-derive rule", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs());
    // The HPE numbers: peak 62.70, 12% give-back → fire line 55.176.
    expect(prompt).toContain("$62.70");
    expect(prompt).toContain("$55.18");
    expect(prompt).toContain("DO NOT RE-DERIVE");
    expect(prompt).toContain("tracked peak $62.70");
  });

  it("inverts the fire line for SHORT positions (peak is the low-water mark)", () => {
    const prompt = buildTacticalSystemPrompt(
      makeArgs({
        thesis: { ...makeArgs().thesis, direction: "SHORT" },
        position: { quantity: 60, avgCost: 70, daysHeld: 10, peakPrice: 50 },
      }),
    );
    // 50 * 1.12 = 56.00, and the fire condition reads "at or above".
    expect(prompt).toContain("$56.00");
    expect(prompt).toContain("at or above");
  });

  it("still forbids re-deriving when the peak is missing from context", () => {
    const prompt = buildTacticalSystemPrompt(
      makeArgs({
        position: { quantity: 60, avgCost: 53.1, daysHeld: 10, peakPrice: null },
      }),
    );
    expect(prompt).toContain("DO NOT RE-DERIVE");
    expect(prompt).toContain("treat the evaluator's fire as correct");
  });

  it("adds no peak block on non-trailing fires", () => {
    const floorTrigger: Trigger = {
      id: "trig_floor",
      predicate: { kind: "PRICE_BELOW", level: 50 },
      action: "EXIT",
      rationale: "Hard stop.",
    };
    const prompt = buildTacticalSystemPrompt(
      makeArgs({
        trigger: floorTrigger,
        thesis: { ...makeArgs().thesis, allTriggers: [floorTrigger] },
      }),
    );
    expect(prompt).not.toContain("DO NOT RE-DERIVE");
    // The position line still shows the watermark for context.
    expect(prompt).toContain("tracked peak $62.70");
  });
});
