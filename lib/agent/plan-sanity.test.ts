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

describe("computePlanSanity — a buy level sitting ON the price", () => {
  // Until 2026-09-02 the thesis writer was instructed to set the entry to
  // "the current price reference from the data block", so the plan's buy
  // condition was true the day it was written. These are the live rows.
  it("flags TOST — buy $35.15 against a $35.16 tape", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 35.15,
      currentPrice: 35.16,
    });
    expect(flags.map((f) => f.kind)).toEqual(["ENTRY_AT_PRICE"]);
    expect(flags[0].text).toContain("this plan has no entry");
  });

  it("flags ISRG — sitting on its own buy level since August", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 401.23,
      currentPrice: 401.29,
    });
    expect(flags.map((f) => f.kind)).toEqual(["ENTRY_AT_PRICE"]);
  });

  it("says nothing about a real breakout level or a real pullback level", () => {
    // CSCO: buy $116.10 against a $111.04 tape. NOW: buy $130 against $132.51.
    expect(
      computePlanSanity({ ...base, entryPrice: 116.1, currentPrice: 111.04 }),
    ).toHaveLength(0);
    expect(
      computePlanSanity({ ...base, entryPrice: 130, currentPrice: 132.51 }),
    ).toHaveLength(0);
  });

  it("mirrors on a SHORT", () => {
    const flags = computePlanSanity({
      ...base,
      direction: "SHORT",
      entryPrice: 100,
      currentPrice: 100.1,
    });
    expect(flags.map((f) => f.kind)).toEqual(["ENTRY_AT_PRICE"]);
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

describe("computePlanSanity — the MNKD shape (stop inside daily noise)", () => {
  it("flags a stop closer to the entry than the ordinary daily move", () => {
    // MNKD's real numbers: entry $4.04, stop $4.00 (~1% apart), ~5% range.
    const flags = computePlanSanity({
      ...base,
      entryPrice: 4.04,
      stopLoss: 4.0,
      currentPrice: 4.27,
      dayRangePct: 5.2,
    });
    expect(flags.map((f) => f.kind)).toContain("STOP_INSIDE_NOISE");
    const flag = flags.find((f) => f.kind === "STOP_INSIDE_NOISE")!;
    expect(flag.text).toContain("$4.00");
    expect(flag.text).toContain("5.2%");
  });

  it("does not flag a stop set outside the daily wiggle", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 100,
      stopLoss: 92, // 8% away
      currentPrice: 101,
      dayRangePct: 3,
    });
    expect(flags.map((f) => f.kind)).not.toContain("STOP_INSIDE_NOISE");
  });

  it("skips the noise check silently when range data is unavailable", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 4.04,
      stopLoss: 4.0,
      currentPrice: 4.27,
      dayRangePct: null,
    });
    expect(flags.map((f) => f.kind)).not.toContain("STOP_INSIDE_NOISE");
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

describe("computePlanSanity — PLAN_BELOW_RR_FLOOR (the floor, read back)", () => {
  it("flags PLTR as stored: 183 / 190 / 110 pays 0.1:1", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 183,
      targetPrice: 190,
      stopLoss: 110,
      currentPrice: 167,
    });
    const rr = flags.find((f) => f.kind === "PLAN_BELOW_RR_FLOOR");
    expect(rr).toBeDefined();
    expect(rr?.text).toContain("0.1:1");
    expect(rr?.text).toContain("$183.00");
  });

  it("stays quiet on a plan that clears 2:1", () => {
    const flags = computePlanSanity({
      ...base,
      entryPrice: 100,
      targetPrice: 130,
      stopLoss: 90,
      currentPrice: 95,
    });
    expect(flags.some((f) => f.kind === "PLAN_BELOW_RR_FLOOR")).toBe(false);
  });
});
