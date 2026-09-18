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

describe("buildTacticalSystemPrompt — confirm by the setup, one run per fire, the fired price (DAV-254, DAV-265)", () => {
  const stop: Trigger = { id: "stop-969", predicate: { kind: "PRICE_BELOW", level: 969 }, action: "EXIT", rationale: "Stop." };
  const trail: Trigger = { id: "trail-8", predicate: { kind: "TRAILING_FROM_HIGH", pct: 8 }, action: "EXIT", rationale: "Trail." };

  it("names the setup's own confirmation and deletes the horizon volume table", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ thesis: { ...makeArgs().thesis, setupId: "PEAD" } }));
    expect(prompt).toContain("THE SETUP THIS PLAN WAS WRITTEN ON");
    expect(prompt).toContain("PEAD — Post-earnings drift (TARGET)");
    expect(prompt).toContain("Confirm a buy by: Gap held; Surprise and guidance confirmed");
    expect(prompt).toContain("(b) **The setup's own confirmation.**");
    expect(prompt).not.toContain("Volume — horizon-conditional");
    expect(prompt).not.toContain("COMPOUNDER horizon:** volume is irrelevant");
  });

  it("with no setup recorded it says so and confirms on the price holding", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ thesis: { ...makeArgs().thesis, setupId: null } }));
    expect(prompt).toContain("(none recorded — a plan from before setups were named");
  });

  it("MU 09-14: a stop and a trail that fired together are both marked and the run decides once", () => {
    const prompt = buildTacticalSystemPrompt(
      makeArgs({
        trigger: stop,
        thesis: { ...makeArgs().thesis, ticker: "MU", allTriggers: [stop, trail] },
        fired: { price: 964.2, coFired: [{ triggerId: "trail-8", predicateKind: "TRAILING_FROM_HIGH", sentence: "Trailing 8% from high — exit position" }] },
      }),
    );
    expect(prompt).toContain("→ FIRED: EXIT");
    expect(prompt).toContain("→ ALSO FIRED: EXIT");
    expect(prompt).toContain("Two protective triggers fired together");
  });

  it("CEG 09-14: the fired price is the price to act on when the tool's quote fails", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ fired: { price: 264.91, coFired: [] } }));
    expect(prompt).toContain("It fired at $264.91.");
    expect(prompt).toContain("act on the fired price above, never on yesterday's");
  });

  it("the re-ladder duty points at the setup's Manage line, not a prose list", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ thesis: { ...makeArgs().thesis, setupId: "PEAD" } }));
    expect(prompt).toContain("using THE SETUP block's Manage line");
    expect(prompt).not.toContain("Set levels like an analyst");
  });
});

// DAV-292 — the tactical run reads how full the analyst is before it
// researches. Replay: ETN, Secular Compounder, 2026-09-18 09:45 ET — the run
// confirmed the buy by its setup, called place_trade, and only then learned
// the analyst held 4 of 4.
describe("buildTacticalSystemPrompt — the analyst's room on a buy fire", () => {
  const thesis = { ...makeArgs().thesis, ticker: "ETN", setupId: "COMPOUNDER_ACCUMULATION" };
  it("a full analyst: says so first, and the run is one update — no research, no place_trade", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ thesis, capacity: { open: 4, max: 4, held: ["ABT", "ASML", "CEG", "WST"] } }));
    expect(prompt).toContain("THE ANALYST'S ROOM");
    expect(prompt).toContain("Positions: 4 of 4 — this analyst is FULL.");
    expect(prompt).toContain("READ THIS BEFORE YOU RESEARCH.");
    expect(prompt).toContain('rationale starting "Buy fired into a full analyst (4 of 4)"');
    expect(prompt).toContain("the weakest of $ABT, $ASML, $CEG, $WST");
    expect(prompt.indexOf("THE ANALYST'S ROOM")).toBeLessThan(prompt.indexOf("THE SETUP THIS PLAN WAS WRITTEN ON"));
  });
  it("an analyst with room: the line only", () => {
    const prompt = buildTacticalSystemPrompt(makeArgs({ thesis, capacity: { open: 4, max: 6, held: ["FIVE", "IOT", "MU", "NVDA"] } }));
    expect(prompt).toContain("Positions: 4 of 6 — 2 free.");
    expect(prompt).not.toContain("READ THIS BEFORE YOU RESEARCH.");
  });
  it("not a buy fire: no room block at all", () => {
    expect(buildTacticalSystemPrompt(makeArgs({ thesis }))).not.toContain("THE ANALYST'S ROOM");
  });
});
