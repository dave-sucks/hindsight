/**
 * plan-sanity.test.ts — the arithmetic that says a written plan
 * contradicts the live tape (DAV-188, THREE_SYSTEMS.md Move 2).
 * Pinned to the production cases that motivated it.
 */

import { computePlanSanity, ENTRY_DISTANCE_FLAG_PCT } from "./plan-sanity";

const base = {
  status: "WATCHING",
  direction: "LONG" as string | null,
  entryPrice: null as number | null,
  targetPrice: null as number | null,
  stopLoss: null as number | null,
  currentPrice: null as number | null,
};

describe("computePlanSanity — the CAPR shape (buy level far from the tape)", () => {
  it("flags a LONG buy level ~20% below the live price", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 400,
      currentPrice: 500,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe("ENTRY_FAR_FROM_PRICE");
    expect(flags[0].text).toContain("$400.00");
    expect(flags[0].text).toContain("$500.00");
    expect(flags[0].text).toContain("below");
  });

  it("flags a buy level stranded far ABOVE the price too", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 600,
      currentPrice: 500,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].text).toContain("above");
  });

  it("does not flag a level inside the tolerance band", () => {
    const nearMiss = 500 * (1 - (ENTRY_DISTANCE_FLAG_PCT - 1) / 100);
    expect(
      computePlanSanity({ ...base, entryPrice: nearMiss, currentPrice: 500 }),
    ).toHaveLength(0);
  });
});

describe("computePlanSanity — goalpost drift and incoherent stops", () => {
  it("flags a LONG target the price has already passed", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 495,
      targetPrice: 480,
      currentPrice: 500,
    });
    expect(flags.map((f) => f.kind)).toContain("TARGET_ALREADY_PASSED");
  });

  it("flags a LONG stop the price is already under", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 505,
      stopLoss: 510,
      currentPrice: 500,
    });
    expect(flags.map((f) => f.kind)).toContain("STOP_ALREADY_BREACHED");
  });

  it("inverts both checks for SHORT plans", () => {
    // A SHORT profits downward: target sits BELOW price, stop ABOVE.
    const notReached = computePlanSanity({
      ...base,
      direction: "SHORT",
      entryPrice: 505,
      targetPrice: 470, // below the price — not reached yet
      currentPrice: 500,
    });
    expect(notReached.map((f) => f.kind)).not.toContain("TARGET_ALREADY_PASSED");

    const reached = computePlanSanity({
      ...base,
      direction: "SHORT",
      entryPrice: 505,
      targetPrice: 495, // price has fallen through it
      currentPrice: 490,
    });
    expect(reached.map((f) => f.kind)).toContain("TARGET_ALREADY_PASSED");

    const breached = computePlanSanity({
      ...base,
      direction: "SHORT",
      entryPrice: 495,
      stopLoss: 498,
      currentPrice: 500, // price above a SHORT's stop = breached
    });
    expect(breached.map((f) => f.kind)).toContain("STOP_ALREADY_BREACHED");
  });
});

describe("computePlanSanity — scope guards", () => {
  it("never flags HOLDING rows (ladder + triggers own that surface)", () => {
    expect(
      computePlanSanity({
        ...base,
        status: "HOLDING",
        entryPrice: 400,
        currentPrice: 500,
      }),
    ).toHaveLength(0);
  });

  it("never flags unresearched seeds or PASS rows", () => {
    expect(
      computePlanSanity({ ...base, direction: null, entryPrice: 400, currentPrice: 500 }),
    ).toHaveLength(0);
  });

  it("stays silent without a live price (fail-open, no guessing)", () => {
    expect(
      computePlanSanity({ ...base, entryPrice: 400, currentPrice: null }),
    ).toHaveLength(0);
  });

  it("can stack multiple flags on one broken plan", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 700, // 40% above price
      targetPrice: 480, // already passed
      stopLoss: 510, // already breached
      currentPrice: 500,
    });
    expect(flags).toHaveLength(3);
  });
});
