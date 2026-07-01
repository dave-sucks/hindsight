/**
 * winner-signal.test.ts — the shared running-winner math (SCALE_INTO_WINNERS.md PR3).
 */

import {
  computeWinnerSignal,
  RUNNING_WINNER_PROGRESS_THRESHOLD,
  RUNNING_WINNER_MIN_GAIN_PCT,
} from "./winner-signal";

describe("computeWinnerSignal — LONG", () => {
  it("computes gain% and progress-to-target", () => {
    // entry 100, target 200, price 175 → gain 75%, progress 0.75
    const s = computeWinnerSignal({
      direction: "LONG",
      avgCost: 100,
      targetPrice: 200,
      currentPrice: 175,
    })!;
    expect(s.unrealizedGainPct).toBeCloseTo(75);
    expect(s.progressToTarget).toBeCloseTo(0.75);
    expect(s.pastTarget).toBe(false);
    expect(s.isRunningWinner).toBe(true); // 0.75 ≥ threshold, 75% ≥ floor
  });

  it("does NOT flag below the progress threshold", () => {
    // entry 22, target 38, price 28 → progress 0.375 (up 27% but far from target)
    const s = computeWinnerSignal({
      direction: "LONG",
      avgCost: 22,
      targetPrice: 38,
      currentPrice: 28,
    })!;
    expect(s.progressToTarget).toBeCloseTo(0.375);
    expect(s.isRunningWinner).toBe(false);
  });

  it("flags past-target (blew through a lowball target — the MU case)", () => {
    // entry 884, target 900, price 1236 → way past target
    const s = computeWinnerSignal({
      direction: "LONG",
      avgCost: 884,
      targetPrice: 900,
      currentPrice: 1236,
    })!;
    expect(s.pastTarget).toBe(true);
    expect(s.isRunningWinner).toBe(true);
    expect(s.progressToTarget!).toBeGreaterThan(1);
  });

  it("respects the gain floor: 75% progress on a trivially-close target does NOT flag", () => {
    // entry 100, target 104, price 103 → progress 0.75 but gain only 3%
    const s = computeWinnerSignal({
      direction: "LONG",
      avgCost: 100,
      targetPrice: 104,
      currentPrice: 103,
    })!;
    expect(s.progressToTarget).toBeCloseTo(0.75);
    expect(s.unrealizedGainPct).toBeCloseTo(3);
    expect(s.isRunningWinner).toBe(false); // 3% < 8% floor
  });

  it("returns progress=null (never a winner) when the target is mis-set below entry", () => {
    const s = computeWinnerSignal({
      direction: "LONG",
      avgCost: 100,
      targetPrice: 90, // target below entry for a LONG — invalid
      currentPrice: 120,
    })!;
    expect(s.progressToTarget).toBeNull();
    expect(s.isRunningWinner).toBe(false);
    expect(s.unrealizedGainPct).toBeCloseTo(20); // gain still computed
  });
});

describe("computeWinnerSignal — SHORT", () => {
  it("computes gain% and progress on the inverted scale", () => {
    // short entry 100, target 60, price 70 → gain 30%, progress (100-70)/(100-60)=0.75
    const s = computeWinnerSignal({
      direction: "SHORT",
      avgCost: 100,
      targetPrice: 60,
      currentPrice: 70,
    })!;
    expect(s.unrealizedGainPct).toBeCloseTo(30);
    expect(s.progressToTarget).toBeCloseTo(0.75);
    expect(s.isRunningWinner).toBe(true);
  });

  it("a rising price on a short is a loss, not a winner", () => {
    const s = computeWinnerSignal({
      direction: "SHORT",
      avgCost: 100,
      targetPrice: 60,
      currentPrice: 120,
    })!;
    expect(s.unrealizedGainPct).toBeCloseTo(-20);
    expect(s.isRunningWinner).toBe(false);
  });
});

describe("computeWinnerSignal — guards", () => {
  it("returns null when avgCost is missing or non-positive", () => {
    expect(
      computeWinnerSignal({ direction: "LONG", avgCost: null, targetPrice: 200, currentPrice: 175 }),
    ).toBeNull();
    expect(
      computeWinnerSignal({ direction: "LONG", avgCost: 0, targetPrice: 200, currentPrice: 175 }),
    ).toBeNull();
  });

  it("returns null when there's no live price", () => {
    expect(
      computeWinnerSignal({ direction: "LONG", avgCost: 100, targetPrice: 200, currentPrice: null }),
    ).toBeNull();
  });

  it("computes gain but null progress when no target is set", () => {
    const s = computeWinnerSignal({
      direction: "LONG",
      avgCost: 100,
      targetPrice: null,
      currentPrice: 130,
    })!;
    expect(s.unrealizedGainPct).toBeCloseTo(30);
    expect(s.progressToTarget).toBeNull();
    expect(s.isRunningWinner).toBe(false);
  });

  it("thresholds are the documented defaults", () => {
    expect(RUNNING_WINNER_PROGRESS_THRESHOLD).toBe(0.75);
    expect(RUNNING_WINNER_MIN_GAIN_PCT).toBe(8);
  });
});
