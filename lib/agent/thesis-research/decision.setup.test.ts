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

describe("HPE 2026-09-15 — the real PEAD refresh, 13 days after the report", () => {
  // Replayed from production: run cmu30r2u20002sky7xsjj9m2u (PEAD Specialist,
  // refresh). Chart that day: price $55.99, 20-day $54.48 rising, 50-day
  // $51.39 rising, ATR(14) $3.75, last swing low $45.70, two gap-downs (09-03
  // and 09-14). The print was 09-02, so this is day 13; PEAD's entry is days
  // 1–3. The writer kept setup PEAD, found no stop the drift rules allowed,
  // and saved an unpriced view with a REVIEW below the 20-day — the very
  // level a pullback plan would buy. On main that decision is accepted.
  const chart = {
    atr14: 3.75,
    pivot: null,
    brokenOut: null,
    sma20: { value: 54.48, rising: true },
    sma50: { value: 51.39, rising: true },
    daysSinceReport: 13,
  };
  const hpe: ThesisDecisionInput = {
    direction: "LONG",
    horizon: "TARGET",
    setup_id: "PEAD",
    rationale:
      "The Q3 print remains a clean PEAD trigger, but two overhead gap zones have broken the stop geometry; the thesis stays LONG and WATCHING unpriced.",
    core_belief: "HPE drifts toward $64+ within 45 days as institutional buyers reaccumulate on the clean beat-and-raise.",
    key_assumptions: ["Record backlog converts to revenue", "FY27 framework holds"],
    invalidation_conditions: ["A close below the 09-03 gap-day low of $45.70", "A guidance cut"],
    scoring: {
      trendStrength: { score: 3, note: "Uptrend over a rising 200-day; Trend Template 8/8" },
      relativeStrength: { score: 2, note: "vs SPY 3M +12.5pts" },
      entryQuality: { score: 1, note: "PEAD condition true in principle, day 13; no clean priced entry today" },
      catalystFreshness: { score: 2, note: "Q3 print 09-02, beat and raise" },
    },
    conviction: "MEDIUM",
    conviction_rationale: "The fundamental PEAD signal is genuine, but two gap-downs have damaged the structure enough that I can't price a clean entry right now.",
    remove_trigger_ids: ["buy-57.25", "floor-54.90", "target-66.50"],
    edit_triggers: [{ id: "review-20d", level: 54.48, rationale: "Anchor the review to the rising 20-day" }],
  };
  const opts = { mode: "refresh" as const, existingStatus: "WATCHING", existingTargetPrice: 66.5, setups: PEAD_SEAT, chart };

  it("is sent back: PEAD's window closed on day 3, and the pullback plan is named with the chart's numbers", () => {
    const v = validateThesisDecision(hpe, opts);
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual([
      "setup_id: Post-earnings drift applies days 1–3 after the report; the last report was 13 days ago, so it no longer does. Write it on MA_PULLBACK: buy at $54.48 (the rising 20-day) or $51.39 (the rising 50-day), stop 1 ATR ($3.75) under it until the pullback low prints, target the prior high at ≥ 2R — or PASS with the reason.",
    ]);
  });

  it("the same view written on the pullback passes: buy at the 20-day, stop 1 ATR under it, the 20-day high as the target", () => {
    const v = validateThesisDecision(
      {
        ...hpe,
        setup_id: "MA_PULLBACK",
        rationale: "Past the drift window; buy the pullback to the rising 20-day with the stop one ATR under it.",
        entry_price: 54.48,
        stop_loss: 50.7,
        target_price: 62.15,
        stop_basis: "1 ATR ($3.75) under the rising 20-day $54.48 until the pullback low prints — $3.78 below entry",
        target_basis: "the 20-day high $62.15; 2.0R from the $54.48 entry",
        remove_trigger_ids: undefined,
        edit_triggers: undefined,
      },
      opts,
    );
    expect(v.errors).toEqual([]);
    expect(v.riskReward).toBeCloseTo(2.03, 2);
  });

  it("inside the window the check is silent, and a held name is never sent back for it", () => {
    const day2 = validateThesisDecision(hpe, { ...opts, chart: { ...chart, daysSinceReport: 2 } });
    expect(day2.errors.some((e) => e.includes("applies days"))).toBe(false);
    const held = validateThesisDecision(
      { ...hpe, remove_trigger_ids: undefined, edit_triggers: undefined },
      { ...opts, existingStatus: "HOLDING" },
    );
    expect(held.errors.some((e) => e.includes("applies days"))).toBe(false);
    const noCalendar = validateThesisDecision(hpe, { ...opts, chart: { ...chart, daysSinceReport: null } });
    expect(noCalendar.errors.some((e) => e.includes("applies days"))).toBe(false);
  });
});

describe("DOCU 2026-09-15 — the same shape, the same night", () => {
  // Replayed from production: run cmu3f9u6y0000opy70bkgdp0n (PEAD Specialist,
  // refresh, 01:28 ET on 09-16). Reported 09-03 → day 13. Chart: price
  // $71.85, 20-day $64.50 rising, 50-day $58.27 rising, ATR $2.98. The writer
  // kept setup PEAD, went unpriced, and wrote the entire pullback plan
  // (buy ~$64.50, stop $61.52, target $82.96, "R/R exceeds 6:1") into the
  // rationale of a REVIEW below $65. On main that is accepted.
  const chart = {
    atr14: 2.98,
    pivot: null,
    brokenOut: null,
    sma20: { value: 64.5, rising: true },
    sma50: { value: 58.27, rising: true },
    daysSinceReport: 13,
  };
  const docu: ThesisDecisionInput = {
    direction: "LONG",
    horizon: "TARGET",
    setup_id: "PEAD",
    rationale:
      "The print delivered a clean PEAD signal; at $71.85 R/R to any defensible target clears only 1.9:1, so I reset the watch for a pullback to the rising 20-day (~$64.50), where R/R to $82.96 exceeds 6:1.",
    core_belief: "DOCU drifts to $83 within 60 days of the September 3 print as HOLD-rated analysts absorb the ARR guide raise.",
    key_assumptions: ["IAM ARR mix keeps expanding toward 18–19%", "The remaining HOLD analysts revise up over 4–6 weeks"],
    invalidation_conditions: ["A close below the gap-day low $64.16 on volume", "Consensus targets stay under $75 for 30 days"],
    scoring: {
      trendStrength: { score: 2, note: "Uptrend above the 200-day; Trend Template 6/8" },
      relativeStrength: { score: 3, note: "vs SPY 3M +62pts" },
      entryQuality: { score: 1, note: "Day 9 of the drift window; extended 11% past the gap" },
      catalystFreshness: { score: 2, note: "Reported 09-03, ARR guide raised" },
    },
    conviction: "MEDIUM",
    conviction_rationale: "The PEAD signal was clean, but the stock has run 11%+ from the gap day; I need the 20-day to come to me.",
    remove_trigger_ids: ["buy-62.50", "floor-57.50", "target-83"],
    add_triggers: [
      {
        action: "REVIEW",
        cooldownDays: 3,
        predicate: { kind: "PRICE_BELOW", level: 65 },
        rationale: "Pullback to the rising 20-day (~$64.50) — evaluate entry with stop $61.52 and target $82.96.",
      },
    ],
  };
  const opts = { mode: "refresh" as const, existingStatus: "WATCHING", existingTargetPrice: 76, setups: PEAD_SEAT, chart };

  it("is sent back with the pullback plan it had already written into a review", () => {
    const v = validateThesisDecision(docu, opts);
    expect(v.errors).toEqual([
      "setup_id: Post-earnings drift applies days 1–3 after the report; the last report was 13 days ago, so it no longer does. Write it on MA_PULLBACK: buy at $64.50 (the rising 20-day) or $58.27 (the rising 50-day), stop 1 ATR ($2.98) under it until the pullback low prints, target the prior high at ≥ 2R — or PASS with the reason.",
    ]);
  });

  it("the plan from its own rationale passes as a pullback: buy $64.50, stop $61.52, target $82.96", () => {
    const v = validateThesisDecision(
      {
        ...docu,
        setup_id: "MA_PULLBACK",
        entry_price: 64.5,
        stop_loss: 61.52,
        target_price: 82.96,
        stop_basis: "1 ATR ($2.98) under the rising 20-day $64.50 until the pullback low prints",
        target_basis: "1.272 extension of the June–September leg, $82.96; 6.2R",
        remove_trigger_ids: undefined,
        add_triggers: undefined,
      },
      opts,
    );
    expect(v.errors).toEqual([]);
    expect(v.riskReward).toBeCloseTo(6.19, 1);
  });
});
