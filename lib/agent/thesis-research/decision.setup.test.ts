/**
 * decision.setup.test.ts — the writer names its setup and says where its
 * numbers came from (DAV-249).
 *
 * Replayed from production: DOCU, minted 2026-09-09 15:37 UTC by the PEAD
 * Specialist (run cmtu9hxmc000004jvp5wbzvpz) — LONG TARGET, entry $62.50,
 * stop $57.50, target $76, MEDIUM, stored setupId null. Chart that day
 * (Alpaca bars through 09-08): ATR(14) $2.94, no base, last swing low
 * $58.73, gapped up 3.9% on 2.5× volume on 09-04. On main this decision is
 * accepted as-is: no setup, no word on why the stop or target sit where they
 * do. Here it comes back with exactly those fields to fix, in-loop.
 */

import { validateThesisDecision, type ThesisDecisionInput } from "./decision";
import { setupsForSeat } from "@/lib/agent/knowledge/setups";

const PEAD_SEAT = setupsForSeat("PEAD Specialist");
const DOCU_CHART = { atr14: 2.94, pivot: null, brokenOut: null };

const docu: ThesisDecisionInput = {
  direction: "LONG",
  horizon: "TARGET",
  rationale: "Post-earnings drift after a clean beat; buy a pullback toward the gap area rather than chase.",
  entry_price: 62.5,
  target_price: 76,
  stop_loss: 57.5,
  core_belief: "DOCU re-rates toward $76 by December as IAM seat growth keeps billings above 8%.",
  key_assumptions: ["Billings growth stays above 8%", "Gross margin holds above 80%"],
  invalidation_conditions: ["A close below $57.50", "Next-quarter billings guide below 6%"],
  scoring: {
    trendStrength: { score: 2, note: "Uptrend over a rising 50-day" },
    relativeStrength: { score: 2, note: "Beating SPY over 1M" },
    entryQuality: { score: 1, note: "Near the gap" },
    catalystFreshness: { score: 2, note: "Reported 09-04" },
  },
  conviction: "MEDIUM",
  conviction_rationale: "The beat was real and the stock held the gap, but the multiple already moved a lot.",
};

const opts = { mode: "mint" as const, setups: PEAD_SEAT, chart: DOCU_CHART };

describe("DOCU 2026-09-09 — the real PEAD mint", () => {
  it("on main this was accepted; now the writer must name the setup and the bases", () => {
    const v = validateThesisDecision(docu, opts);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.startsWith("setup_id: required"))).toBe(true);
    expect(v.errors.some((e) => e.startsWith("stop_basis: required"))).toBe(true);
    expect(v.errors.some((e) => e.startsWith("target_basis: required"))).toBe(true);
  });

  it("the repaired decision passes — the numbers didn't have to move", () => {
    const v = validateThesisDecision(
      {
        ...docu,
        setup_id: "PEAD",
        stop_basis: "under the 08-26 swing low $58.73 — $5.00 below entry, 1.7 ATR",
        target_basis: "prior high area $76; 2.7R from the $62.50 entry",
      },
      opts,
    );
    expect(v.errors).toEqual([]);
  });

  it("a setup this seat doesn't run is sent back with the seat's list", () => {
    const v = validateThesisDecision({ ...docu, setup_id: "BASE_BREAKOUT", stop_basis: "x".repeat(12), target_basis: "y".repeat(12) }, opts);
    expect(v.errors[0]).toMatch(/^setup_id: BASE_BREAKOUT isn't one of this seat's setups \(EPISODIC_PIVOT, PEAD, MA_PULLBACK\)/);
  });

  it("a stop inside one ordinary day's move is sent back with the numbers", () => {
    const v = validateThesisDecision(
      { ...docu, setup_id: "PEAD", stop_loss: 61, target_price: 66, stop_basis: "just under today", target_basis: "3.3R, prior high" },
      opts,
    );
    expect(v.errors).toContain(
      "stop_loss: $61 is 0.51 ATR from the $62.5 entry (ATR $2.94). Post-earnings drift needs the stop at least 1 ATR away — inside that it sells on an ordinary day's movement. Put it under real structure at least $2.94 from entry, or PASS.",
    );
  });

  it("a buy at the live price is legal — that is how buying now is written", () => {
    const v = validateThesisDecision(
      { ...docu, setup_id: "PEAD", entry_price: 65.08, stop_loss: 58.6, target_price: 78.5, stop_basis: "under the swing low $58.73, 2.2 ATR", target_basis: "2.1R, measured from the gap" },
      { ...opts, currentPrice: 65.08 },
    );
    expect(v.errors).toEqual([]);
  });
});

describe("FIVE 2026-09-09 chart — the chase limit on a breakout", () => {
  // FIVE's base that day: pivot $263.88, not broken out (ATR $10.65).
  const chart = { atr14: 10.65, pivot: 263.88, brokenOut: false };
  const seat = setupsForSeat("Secular Compounder");
  const breakout = {
    ...docu,
    horizon: "TARGET" as const,
    setup_id: "BASE_BREAKOUT" as const,
    entry_price: 280,
    stop_loss: 255,
    target_price: 340,
    stop_basis: "under the last contraction low, 2.3 ATR",
    target_basis: "measured move, base depth added to the pivot",
  };
  it("an entry 6.1% past the pivot is sent back", () => {
    const v = validateThesisDecision(breakout, { mode: "mint", setups: seat, chart });
    expect(v.errors.some((e) => e.startsWith("entry_price: $280 is 6.1% past the base pivot $263.88"))).toBe(true);
  });
  it("an entry at the pivot plus a buffer passes", () => {
    const v = validateThesisDecision({ ...breakout, entry_price: 264.5, stop_loss: 240, target_price: 320 }, { mode: "mint", setups: seat, chart });
    expect(v.errors).toEqual([]);
  });
});
