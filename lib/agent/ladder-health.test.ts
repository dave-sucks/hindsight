/**
 * ladder-health.test.ts — the shared ladder-health / UNPROTECTED_GAIN math
 * (Game Plan PR-B; docs/plans/THESIS_GAME_PLAN.md §6 row B).
 */

import {
  computeLadderHealth,
  isLadderEditUpdate,
  UNPROTECTED_GAIN_MIN_GAIN_PCT,
  UNPROTECTED_GAIN_GAP_PCT,
} from "./ladder-health";
import type { Trigger } from "./triggers/types";

const NOW = new Date("2026-07-09T12:00:00Z");

function exitBelow(level: number, id = "trig-stop"): Trigger {
  return {
    id,
    predicate: { kind: "PRICE_BELOW", level },
    action: "EXIT",
    rationale: "stop",
    cooldownDays: 0,
  };
}

function exitAbove(level: number, id = "trig-cover"): Trigger {
  return {
    id,
    predicate: { kind: "PRICE_ABOVE", level },
    action: "EXIT",
    rationale: "cover stop",
    cooldownDays: 0,
  };
}

function trailExit(pct: number, id = "trig-trail"): Trigger {
  return {
    id,
    predicate: { kind: "TRAILING_FROM_HIGH", pct },
    action: "EXIT",
    rationale: "gain ratchet",
    cooldownDays: 0,
  };
}

const baseLong = {
  direction: "LONG" as string | null,
  lastLadderEditAt: null as Date | null,
  now: NOW,
};

describe("computeLadderHealth — the IONS replay (LONG)", () => {
  // Bought $73.83, day-one floor $65, ran to $86.24 (+16.8%) — the floor
  // locks −12% BELOW entry. Must flag every morning until the floor rises.
  it("flags a +17% position whose only floor is the day-one stop below entry", () => {
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 73.83,
      currentPrice: 86.24,
      triggers: [exitBelow(65)],
    })!;
    expect(h.gainPct).toBeCloseTo(16.81, 1);
    expect(h.floor?.price).toBe(65);
    expect(h.flooredGainPct).toBeCloseTo(-11.96, 1);
    expect(h.unprotectedGapPct).toBeCloseTo(28.77, 1);
    expect(h.hasTrail).toBe(false);
    expect(h.isUnprotectedGain).toBe(true);
    expect(h.summary).toContain("UNPROTECTED GAIN");
    expect(h.summary).toContain("BELOW entry");
  });

  it("stops flagging once the floor is raised to lock most of the gain", () => {
    // Same position, floor raised to $78.50 (locks +6.3%): gap 10.5 → still
    // ≥ 6... so raise further to $82 (locks +11.1%, gap 5.7) → protected.
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 73.83,
      currentPrice: 86.24,
      triggers: [exitBelow(82)],
    })!;
    expect(h.flooredGainPct).toBeCloseTo(11.07, 1);
    expect(h.unprotectedGapPct).toBeCloseTo(5.74, 1);
    expect(h.isUnprotectedGain).toBe(false);
  });
});

describe("computeLadderHealth — the flag rule (LONG)", () => {
  it("does NOT flag below the minimum gain even with NO floor at all", () => {
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 107, // +7% < 8% min
      triggers: [],
    })!;
    expect(h.floor).toBeNull();
    expect(h.flooredGainPct).toBeNull();
    expect(h.unprotectedGapPct).toBeNull();
    expect(h.isUnprotectedGain).toBe(false);
  });

  it("flags a qualifying gain with NO floor (missing floor = −infinity)", () => {
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 110,
      triggers: [],
    })!;
    expect(h.floor).toBeNull();
    expect(h.isUnprotectedGain).toBe(true);
    expect(h.summary).toContain("NO FLOOR");
  });

  it("gap exactly at the threshold flags (>= semantics)", () => {
    // +12% gain, floor locks +6% → gap exactly 6.
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 112,
      triggers: [exitBelow(106)],
    })!;
    expect(h.unprotectedGapPct).toBeCloseTo(6);
    expect(h.isUnprotectedGain).toBe(true);
  });

  it("gap just under the threshold does not flag", () => {
    // +10% gain, floor locks +5% → gap 5 < 6.
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 110,
      triggers: [exitBelow(105)],
    })!;
    expect(h.unprotectedGapPct).toBeCloseTo(5);
    expect(h.isUnprotectedGain).toBe(false);
  });

  it("TRIM / MOVE_STOP / REVIEW rungs do NOT count as protection", () => {
    const trim: Trigger = {
      id: "trig-trim",
      predicate: { kind: "PRICE_BELOW", level: 108 },
      action: "TRIM",
      rationale: "partial de-risk",
    };
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 110,
      triggers: [trim],
    })!;
    expect(h.floor).toBeNull();
    expect(h.isUnprotectedGain).toBe(true);
  });

  it("the TIGHTEST floor wins (max locked gain across EXIT rungs)", () => {
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 120,
      triggers: [exitBelow(90, "trig-old-stop"), exitBelow(112, "trig-new-stop")],
    })!;
    expect(h.floor?.triggerId).toBe("trig-new-stop");
    expect(h.flooredGainPct).toBeCloseTo(12);
    // gain 20 − floored 12 = gap 8 ≥ 6 → still flagged; the tightest floor
    // just narrows the reported gap.
    expect(h.unprotectedGapPct).toBeCloseTo(8);
    expect(h.isUnprotectedGain).toBe(true);
  });
});

describe("computeLadderHealth — trailing floors (LONG)", () => {
  it("a tight trail counts as protection: floor = peak × (1 − pct/100)", () => {
    // peak 120, trail 5% → floor 114 (locks +14); gain +18 → gap 4 → protected.
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 118,
      peakPrice: 120,
      triggers: [trailExit(5)],
    })!;
    expect(h.hasTrail).toBe(true);
    expect(h.floor?.isTrail).toBe(true);
    expect(h.floor?.price).toBeCloseTo(114);
    expect(h.flooredGainPct).toBeCloseTo(14);
    expect(h.isUnprotectedGain).toBe(false);
  });

  it("a too-wide trail still flags (trail on ≠ protected)", () => {
    // peak 120, trail 10% → floor 108 (locks +8); gain +18 → gap 10 ≥ 6.
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 118,
      peakPrice: 120,
      triggers: [trailExit(10)],
    })!;
    expect(h.hasTrail).toBe(true);
    expect(h.isUnprotectedGain).toBe(true);
  });

  it("falls back to the current price when peakPrice is null", () => {
    // no peak → peak = current 118; trail 5% → floor 112.1 (locks +12.1).
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 118,
      peakPrice: null,
      triggers: [trailExit(5)],
    })!;
    expect(h.floor?.price).toBeCloseTo(112.1);
  });

  it("water-mark-corrects a stale stored peak below the live price", () => {
    // stored peak 110 lags the live 118 → the enforceable trail ratchets off
    // max(peak, current) = 118, not the stale 110.
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 118,
      peakPrice: 110,
      triggers: [trailExit(5)],
    })!;
    expect(h.floor?.price).toBeCloseTo(112.1);
  });
});

describe("computeLadderHealth — predicate composition", () => {
  it("finds a floor inside an OR (any branch fires alone)", () => {
    const orExit: Trigger = {
      id: "trig-or",
      predicate: {
        kind: "OR",
        predicates: [
          { kind: "PRICE_BELOW", level: 105 },
          { kind: "PRICE_ABOVE", level: 140 },
        ],
      },
      action: "EXIT",
      rationale: "stop or take-profit",
    };
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 112,
      triggers: [orExit],
    })!;
    expect(h.floor?.price).toBe(105);
    expect(h.flooredGainPct).toBeCloseTo(5);
  });

  it("does NOT count a level inside an AND (conditional, not standalone protection)", () => {
    const andExit: Trigger = {
      id: "trig-and",
      predicate: {
        kind: "AND",
        predicates: [
          { kind: "PRICE_BELOW", level: 105 },
          { kind: "SIGNAL_TYPE", signalType: "NEWS" },
        ],
      },
      action: "EXIT",
      rationale: "conditional exit",
    };
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 112,
      triggers: [andExit],
    })!;
    expect(h.floor).toBeNull();
  });

  it("counts a GAIN_FROM_ENTRY DOWN EXIT as a floor at avgCost × (1 − pct/100)", () => {
    const drawdownExit: Trigger = {
      id: "trig-dd",
      predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" },
      action: "EXIT",
      rationale: "drawdown cut",
    };
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 115,
      triggers: [drawdownExit],
    })!;
    expect(h.floor?.price).toBeCloseTo(88);
    expect(h.flooredGainPct).toBeCloseTo(-12);
    expect(h.isUnprotectedGain).toBe(true); // +15 vs −12 floor
  });
});

describe("computeLadderHealth — nearest forward rung", () => {
  it("picks the closest not-yet-matching rung across all actions", () => {
    const add: Trigger = {
      id: "trig-add",
      predicate: { kind: "PRICE_ABOVE", level: 120 },
      action: "ADD",
      rationale: "breakout add",
    };
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 110,
      triggers: [add, exitBelow(90)],
    })!;
    // +9.1% to the add rung vs −18.2% to the stop → the add is nearest.
    expect(h.nearestRung?.triggerId).toBe("trig-add");
    expect(h.nearestRung?.action).toBe("ADD");
    expect(h.nearestRung?.distancePct).toBeCloseTo(9.09, 1);
  });

  it("excludes already-matching rungs (a PRICE_ABOVE below the current price)", () => {
    const stale: Trigger = {
      id: "trig-stale",
      predicate: { kind: "PRICE_ABOVE", level: 105 },
      action: "ADD",
      rationale: "already crossed",
    };
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 110,
      triggers: [stale, exitBelow(95)],
    })!;
    expect(h.nearestRung?.triggerId).toBe("trig-stop");
  });

  it("maps a GAIN_FROM_ENTRY UP rung to its implied price", () => {
    const milestone: Trigger = {
      id: "trig-up10",
      predicate: { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" },
      action: "REVIEW",
      rationale: "gain checkpoint",
    };
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 105,
      triggers: [milestone],
    })!;
    expect(h.nearestRung?.price).toBeCloseTo(110);
    expect(h.nearestRung?.distancePct).toBeCloseTo(4.76, 1);
  });

  it("returns null when there are no forward price rungs", () => {
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 110,
      triggers: [],
    })!;
    expect(h.nearestRung).toBeNull();
  });
});

describe("computeLadderHealth — SHORT (inverted math)", () => {
  const baseShort = { ...baseLong, direction: "SHORT" as string | null };

  it("flags a winning short whose only cover-stop is above entry", () => {
    // Short at 100, price 85 → gain +15. Cover stop at 110 locks −10.
    const h = computeLadderHealth({
      ...baseShort,
      avgCost: 100,
      currentPrice: 85,
      triggers: [exitAbove(110)],
    })!;
    expect(h.gainPct).toBeCloseTo(15);
    expect(h.flooredGainPct).toBeCloseTo(-10);
    expect(h.unprotectedGapPct).toBeCloseTo(25);
    expect(h.isUnprotectedGain).toBe(true);
  });

  it("a lowered cover-stop protects the short's gain", () => {
    // Cover at 90 locks +10; gain +15 → gap 5 < 6.
    const h = computeLadderHealth({
      ...baseShort,
      avgCost: 100,
      currentPrice: 85,
      triggers: [exitAbove(90)],
    })!;
    expect(h.flooredGainPct).toBeCloseTo(10);
    expect(h.isUnprotectedGain).toBe(false);
  });

  it("a PRICE_BELOW take-profit on a short is NOT a floor", () => {
    const takeProfit = exitBelow(70, "trig-tp");
    const h = computeLadderHealth({
      ...baseShort,
      avgCost: 100,
      currentPrice: 85,
      triggers: [takeProfit],
    })!;
    expect(h.floor).toBeNull();
    expect(h.isUnprotectedGain).toBe(true);
  });

  it("trail floor uses the low-water mark: peak × (1 + pct/100)", () => {
    // low-water 80, trail 10% → cover at 88 locks +12; gain +15 → gap 3.
    const h = computeLadderHealth({
      ...baseShort,
      avgCost: 100,
      currentPrice: 85,
      peakPrice: 80,
      triggers: [trailExit(10)],
    })!;
    expect(h.hasTrail).toBe(true);
    expect(h.floor?.price).toBeCloseTo(88);
    expect(h.flooredGainPct).toBeCloseTo(12);
    expect(h.isUnprotectedGain).toBe(false);
  });

  it("water-mark-corrects a stale low-water mark above the live price", () => {
    // stored low 90 lags the live 85 → trail ratchets off min(90, 85) = 85.
    const h = computeLadderHealth({
      ...baseShort,
      avgCost: 100,
      currentPrice: 85,
      peakPrice: 90,
      triggers: [trailExit(10)],
    })!;
    expect(h.floor?.price).toBeCloseTo(93.5);
  });
});

describe("computeLadderHealth — daysSinceLadderEdit + guards", () => {
  it("computes whole days since the last ladder edit", () => {
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 110,
      triggers: [exitBelow(95)],
      lastLadderEditAt: new Date("2026-06-10T12:00:00Z"), // 29 days before NOW
    })!;
    expect(h.daysSinceLadderEdit).toBe(29);
    expect(h.summary).toContain("ladder last edited 29d ago");
  });

  it("omits daysSinceLadderEdit when the caller couldn't resolve it", () => {
    const h = computeLadderHealth({
      ...baseLong,
      avgCost: 100,
      currentPrice: 110,
      triggers: [exitBelow(95)],
      lastLadderEditAt: null,
    })!;
    expect(h.daysSinceLadderEdit).toBeNull();
    expect(h.summary).not.toContain("ladder last edited");
  });

  it("returns null when avgCost is missing or non-positive", () => {
    expect(
      computeLadderHealth({ ...baseLong, avgCost: null, currentPrice: 110, triggers: [] }),
    ).toBeNull();
    expect(
      computeLadderHealth({ ...baseLong, avgCost: 0, currentPrice: 110, triggers: [] }),
    ).toBeNull();
  });

  it("returns null when there's no live price", () => {
    expect(
      computeLadderHealth({ ...baseLong, avgCost: 100, currentPrice: null, triggers: [] }),
    ).toBeNull();
  });

  it("thresholds are the documented defaults", () => {
    expect(UNPROTECTED_GAIN_MIN_GAIN_PCT).toBe(8);
    expect(UNPROTECTED_GAIN_GAP_PCT).toBe(6);
  });
});

describe("isLadderEditUpdate", () => {
  it("CREATED always counts (the ladder is born with the thesis)", () => {
    expect(isLadderEditUpdate("CREATED", {})).toBe(true);
  });

  it("UPDATED counts when fieldChanges touches a ladder key", () => {
    expect(
      isLadderEditUpdate("UPDATED", { triggers: { from: [], to: [{}] } }),
    ).toBe(true);
    expect(
      isLadderEditUpdate("UPDATED", { fireMode: { from: "TACTICAL", to: "DIRECT" } }),
    ).toBe(true);
    expect(
      isLadderEditUpdate("UPDATED", { stopLoss: { from: 65, to: 80 } }),
    ).toBe(true);
  });

  it("UPDATED does NOT count for non-ladder keys (target move, prose re-attest)", () => {
    expect(
      isLadderEditUpdate("UPDATED", { targetPrice: { from: 90, to: 100 } }),
    ).toBe(false);
    expect(isLadderEditUpdate("UPDATED", { source: { from: null, to: "USER" } })).toBe(
      false,
    );
    expect(isLadderEditUpdate("UPDATED", {})).toBe(false);
    expect(isLadderEditUpdate("UPDATED", null)).toBe(false);
  });

  it("fires and reviews never count — the exact rows the metric must not reset on", () => {
    expect(
      isLadderEditUpdate("TRIGGER_FIRED", { triggers: { from: [], to: [] } }),
    ).toBe(false);
    expect(isLadderEditUpdate("REVIEWED", {})).toBe(false);
    expect(isLadderEditUpdate("PROPOSAL_REJECTED", {})).toBe(false);
  });
});
