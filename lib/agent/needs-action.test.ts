/**
 * computeNeedsAction — trigger-driven only. NEAR_TARGET / NEAR_STOP /
 * ENTRY_MET are NOT valid kinds (those would be hardcoded-threshold
 * heuristics, exactly the parallel-logic bug Fix #0 removes).
 */

import { computeNeedsAction } from "./needs-action";
import type { Trigger } from "./triggers/types";

const ENTER_LONG: Trigger = {
  id: "trig-enter",
  predicate: { kind: "PRICE_ABOVE", level: 100 },
  action: "ENTER",
  rationale: "Entry on breakout",
  cooldownDays: 1,
};

const EXIT_LONG: Trigger = {
  id: "trig-exit",
  predicate: { kind: "PRICE_BELOW", level: 90 },
  action: "EXIT",
  rationale: "Stop at 90",
  cooldownDays: 0,
};

const REVIEW_HYGIENE: Trigger = {
  id: "trig-review",
  predicate: { kind: "TIME_ELAPSED", days: 30 },
  action: "REVIEW",
  rationale: "Monthly hygiene",
  cooldownDays: 25,
};

const SIGNAL_EARNINGS: Trigger = {
  id: "trig-earnings",
  predicate: { kind: "EARNINGS_BEAT" },
  action: "REVIEW",
  rationale: "Earnings beat",
  cooldownDays: 7,
};

const baseThesis = {
  id: "thesis-1",
  // Committed direction by default — the production caller always passes the
  // DB value (string | null, never undefined). Seed-specific tests override
  // with direction: null / "PENDING" to exercise the pendingFirstReview path
  // (P1-24 B4). A committed default keeps the generic REVIEW_DUE tests from
  // accidentally tripping the seed discriminator.
  direction: "LONG" as string | null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  nextReviewAt: null as Date | null,
};

const now = new Date("2026-05-10T12:00:00Z");

describe("computeNeedsAction — PROMOTED_AWAITING_RESOLUTION (top precedence)", () => {
  it("returns PROMOTED_AWAITING_RESOLUTION when status is PROMOTED, regardless of trigger state", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        status: "PROMOTED",
        triggers: [EXIT_LONG],
        paperTenureDays: 50,
        paperRealizedPnl: 183.7,
        paperReviewCount: 17,
        promotedAt: new Date("2026-05-26T04:42:31Z"),
      },
      // Even with a TRIGGER_FIRED on top of the stack, PROMOTED status
      // takes precedence — the run must address the promotion decision.
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      },
      latestQuote: { price: 80, changePct: 0 },
      now,
    });
    expect(result).toEqual({
      kind: "PROMOTED_AWAITING_RESOLUTION",
      paperTenureDays: 50,
      paperRealizedPnl: 183.7,
      paperReviewCount: 17,
      promotedAt: "2026-05-26T04:42:31.000Z",
    });
  });

  it("returns PROMOTED_AWAITING_RESOLUTION even when conviction context fields are missing (pre-PR-#330 rows)", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        status: "PROMOTED",
        triggers: [],
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({
      kind: "PROMOTED_AWAITING_RESOLUTION",
      paperTenureDays: null,
      paperRealizedPnl: null,
      paperReviewCount: null,
      promotedAt: null,
    });
  });

  it("does NOT return PROMOTED_AWAITING_RESOLUTION when status is WATCHING (falls through normally)", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        status: "WATCHING",
        triggers: [],
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });
});

describe("computeNeedsAction — pending entry proposal suppresses ENTER (P1-25 Change 4)", () => {
  it("suppresses a fired ENTER trigger when a buy proposal is pending", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [ENTER_LONG] },
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "trig-enter",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      },
      latestQuote: { price: 120, changePct: 0 },
      now,
      hasPendingEntryProposal: true,
    });
    expect(result).toBeNull();
  });

  it("suppresses a matching-now ENTER predicate when a buy proposal is pending", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [ENTER_LONG] },
      latestUpdate: null,
      latestQuote: { price: 120, changePct: 0 }, // above 100 → ENTER matches
      now,
      hasPendingEntryProposal: true,
    });
    expect(result).toBeNull();
  });

  it("still surfaces a fired EXIT trigger when a buy proposal is pending (only ENTER suppressed)", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [EXIT_LONG] },
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      },
      latestQuote: { price: 80, changePct: 0 },
      now,
      hasPendingEntryProposal: true,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
  });

  it("surfaces the ENTER normally when no proposal is pending", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [ENTER_LONG] },
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "trig-enter",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      },
      latestQuote: { price: 120, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
    if (result && result.kind === "TRIGGER_FIRED") {
      expect(result.action).toBe("ENTER");
    }
  });
});

describe("computeNeedsAction — TRIGGER_FIRED precedence", () => {
  it("returns TRIGGER_FIRED when latest ThesisUpdate is an unanswered fire", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      },
      latestQuote: { price: 80, changePct: 0 },
      now,
    });
    expect(result).toEqual({
      kind: "TRIGGER_FIRED",
      triggerId: "trig-exit",
      action: "EXIT",
      summary: "price < $90",
      firedAt: "2026-05-10T09:00:00.000Z",
    });
  });

  it("includes a graceful fallback when the firing triggerId was deleted", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "ghost-trigger",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      },
      latestQuote: null,
      now,
    });
    expect(result).toEqual({
      kind: "TRIGGER_FIRED",
      triggerId: "ghost-trigger",
      action: "REVIEW",
      summary: "(predicate removed)",
      firedAt: "2026-05-10T09:00:00.000Z",
    });
  });

  it("falls through to MATCHING_NOW when latest update is a UPDATED row (answered)", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      latestUpdate: {
        type: "UPDATED",
        triggerId: null,
        timestamp: new Date("2026-05-10T09:00:00Z"),
      },
      latestQuote: { price: 80, changePct: 0 }, // below stop
      now,
    });
    expect(result?.kind).toBe("TRIGGER_MATCHING_NOW");
  });
});

describe("computeNeedsAction — TRIGGER_MATCHING_NOW", () => {
  it("returns TRIGGER_MATCHING_NOW when a price predicate is currently true", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [ENTER_LONG] },
      latestUpdate: null,
      latestQuote: { price: 105, changePct: 1 },
      now,
    });
    expect(result).toEqual({
      kind: "TRIGGER_MATCHING_NOW",
      triggerId: "trig-enter",
      action: "ENTER",
      predicateSummary: "price > $100",
      livePrice: 105,
    });
  });

  it("returns null when no predicate matches", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [ENTER_LONG, EXIT_LONG] },
      latestUpdate: null,
      latestQuote: { price: 95, changePct: 0 }, // between stop and entry-trigger
      now,
    });
    expect(result).toBeNull();
  });

  it("skips signal-side predicates (no signal payload available at run-start)", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [SIGNAL_EARNINGS] },
      latestUpdate: null,
      latestQuote: { price: 100, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });

  it("does not fire when the quote is missing (price-side eval needs a quote)", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });
});

describe("computeNeedsAction — REVIEW_DUE", () => {
  it("returns REVIEW_DUE when nextReviewAt is in the past", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [],
        nextReviewAt: new Date("2026-05-06T00:00:00Z"),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 4 });
  });

  it("flags pendingFirstReview on a null-direction seed (P1-24 B4)", () => {
    // An unresearched watchlist seed now stores direction=null. A seed is
    // minted with nextReviewAt = createdAt so it surfaces as REVIEW_DUE on
    // the next run; the null-direction discriminator must set
    // pendingFirstReview so the prompt routes it to the "commit a direction"
    // path (exactly as legacy 'PENDING' did).
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        direction: null,
        triggers: [],
        nextReviewAt: new Date("2026-05-06T00:00:00Z"),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({
      kind: "REVIEW_DUE",
      daysOverdue: 4,
      pendingFirstReview: true,
    });
  });

  it("flags pendingFirstReview on a legacy 'PENDING' seed (dual-read window)", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        direction: null,
        triggers: [],
        nextReviewAt: new Date("2026-05-06T00:00:00Z"),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({
      kind: "REVIEW_DUE",
      daysOverdue: 4,
      pendingFirstReview: true,
    });
  });

  it("does NOT flag pendingFirstReview on a committed LONG that is REVIEW_DUE", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        direction: "LONG",
        triggers: [],
        nextReviewAt: new Date("2026-05-06T00:00:00Z"),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 4 });
  });

  it("returns null when nextReviewAt is beyond the 24h look-ahead", () => {
    // now = 2026-05-10T12:00Z; nextReviewAt = 2026-05-20T00:00 (10d future)
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [],
        nextReviewAt: new Date("2026-05-20T00:00:00Z"),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });

  it("returns null when nextReviewAt is null and no triggers fire", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [] },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });

  // Anti-regression for the 2026-05-20 NVDA case: morning daily-run at
  // 08:00 ET (12:00 UTC) needs to catch a thesis whose nextReviewAt is
  // later TODAY (e.g. 09:30 ET = 13:30 UTC). Before the look-ahead
  // window was added, this returned null and the trigger evaluator's
  // REVIEW_DATE_HIT cron picked it up 90 min later in a redundant
  // tactical run.
  it("returns REVIEW_DUE when nextReviewAt is later TODAY (within 24h look-ahead)", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [],
        // now = 12:00 UTC; this is 13:30 UTC same day (90 min ahead)
        nextReviewAt: new Date("2026-05-10T13:30:00Z"),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 0 });
  });

  it("returns REVIEW_DUE with daysOverdue: 0 when nextReviewAt is within 24h ahead", () => {
    // now = 12:00 UTC; nextReviewAt = +23h
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [],
        nextReviewAt: new Date(now.getTime() + 23 * 60 * 60 * 1000),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 0 });
  });

  it("returns null when nextReviewAt is just past the 24h look-ahead (+25h)", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [],
        nextReviewAt: new Date(now.getTime() + 25 * 60 * 60 * 1000),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });
});

describe("computeNeedsAction — precedence (FIRED > MATCHING_NOW > REVIEW_DUE)", () => {
  it("FIRED beats MATCHING_NOW + REVIEW_DUE", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [EXIT_LONG, REVIEW_HYGIENE],
        nextReviewAt: new Date("2026-05-06T00:00:00Z"),
      },
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-10T08:00:00Z"),
      },
      latestQuote: { price: 80, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
  });

  it("MATCHING_NOW beats REVIEW_DUE", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [ENTER_LONG],
        nextReviewAt: new Date("2026-05-06T00:00:00Z"),
      },
      latestUpdate: null,
      latestQuote: { price: 105, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("TRIGGER_MATCHING_NOW");
  });
});

describe("computeNeedsAction — anti-regression (no hardcoded thresholds)", () => {
  it("does NOT return any heuristic NEAR_TARGET kind even when price is at 95% of target", () => {
    // 6-month TARGET hold: entry $100, target $120 (95% means price=$119),
    // stop $90. No NEAR_TARGET trigger set by the agent. Helper MUST NOT
    // fabricate proximity heuristics — that would reintroduce the bug
    // Fix #0 removes from price-monitor.
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      latestUpdate: null,
      latestQuote: { price: 119, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });

  it("does NOT return NEAR_STOP at -3% when stop is -10%", () => {
    // Anchor scenario from the design: 6-month TARGET, -5% stop. Price
    // ticks -3% intraday. Pre-fix this fired NEAR_STOP at 80% proximity.
    // With Fix #2 the helper does nothing — the agent set a $90 stop,
    // not a $95 review trigger; the trigger predicate must literally
    // match.
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      latestUpdate: null,
      latestQuote: { price: 97, changePct: 0 }, // -3% from entry, well above stop $90
      now,
    });
    expect(result).toBeNull();
  });
});

describe("computeNeedsAction — UNPROTECTED_GAIN (Game Plan PR-B, the IONS detector)", () => {
  // IONS shape: bought 73.83, day-one EXIT floor at 65 (−12% below entry),
  // ran +17% — the floor never re-earned. Must flag every morning.
  const ionsExit: Trigger = {
    id: "trig-ions-floor",
    predicate: { kind: "PRICE_BELOW", level: 65 },
    action: "EXIT",
    rationale: "day-one stop",
    cooldownDays: 0,
  };
  const ionsThesis = {
    ...baseThesis,
    status: "HOLDING",
    triggers: [ionsExit],
    avgCost: 73.83,
    targetPrice: null as number | null, // no target → RUNNING_WINNER can't mask
  };

  it("flags a +17% holding whose floor locks −12% (the IONS shape)", () => {
    const result = computeNeedsAction({
      thesis: ionsThesis,
      latestUpdate: null,
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("UNPROTECTED_GAIN");
    if (result?.kind === "UNPROTECTED_GAIN") {
      expect(result.unrealizedGainPct).toBeCloseTo(16.81, 1);
      expect(result.flooredGainPct).toBeCloseTo(-11.96, 1);
      expect(result.unprotectedGapPct).toBeCloseTo(28.77, 1);
      expect(result.hasTrail).toBe(false);
      expect(result.floorSummary).toContain("$65.00");
    }
  });

  it("flags a qualifying gain with NO protective EXIT rung at all", () => {
    const result = computeNeedsAction({
      thesis: { ...ionsThesis, triggers: [] },
      latestUpdate: null,
      latestQuote: { price: 82, changePct: 0 }, // +11.1%
      now,
    });
    expect(result?.kind).toBe("UNPROTECTED_GAIN");
    if (result?.kind === "UNPROTECTED_GAIN") {
      expect(result.flooredGainPct).toBeNull();
      expect(result.unprotectedGapPct).toBeNull();
      expect(result.floorSummary).toBeNull();
    }
  });

  it("does NOT flag when the floor reflects the gain (gap under threshold)", () => {
    const raisedFloor: Trigger = {
      ...ionsExit,
      predicate: { kind: "PRICE_BELOW", level: 82 }, // locks +11.1% vs +16.8% gain
    };
    const result = computeNeedsAction({
      thesis: { ...ionsThesis, triggers: [raisedFloor] },
      latestUpdate: null,
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });

  it("a fired EXIT trigger outranks UNPROTECTED_GAIN", () => {
    const result = computeNeedsAction({
      thesis: ionsThesis,
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "trig-ions-floor",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      },
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
  });

  it("a matching-now predicate outranks UNPROTECTED_GAIN", () => {
    const addRung: Trigger = {
      id: "trig-add",
      predicate: { kind: "PRICE_ABOVE", level: 85 },
      action: "ADD",
      rationale: "breakout add",
      cooldownDays: 1,
    };
    const result = computeNeedsAction({
      thesis: { ...ionsThesis, triggers: [ionsExit, addRung] },
      latestUpdate: null,
      latestQuote: { price: 86.24, changePct: 0 }, // above 85 → ADD matches
      now,
    });
    expect(result?.kind).toBe("TRIGGER_MATCHING_NOW");
  });

  it("UNPROTECTED_GAIN outranks RUNNING_WINNER when both fire (floor-first)", () => {
    // avgCost 100, target 120, price 118: RUNNING_WINNER fires (progress 0.9,
    // +18%) — but there's no floor, so UNPROTECTED_GAIN must win.
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        status: "HOLDING",
        triggers: [],
        avgCost: 100,
        targetPrice: 120,
      },
      latestUpdate: null,
      latestQuote: { price: 118, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("UNPROTECTED_GAIN");
  });

  it("a protected winner falls through to RUNNING_WINNER (press/hold/take)", () => {
    // Same winner, but a tight floor locks +14 (gap 4 < 6): the unprotected
    // flag self-clears and the press decision surfaces.
    const tightFloor: Trigger = {
      id: "trig-tight",
      predicate: { kind: "PRICE_BELOW", level: 114 },
      action: "EXIT",
      rationale: "ratcheted floor",
      cooldownDays: 0,
    };
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        status: "HOLDING",
        triggers: [tightFloor],
        avgCost: 100,
        targetPrice: 120,
      },
      latestUpdate: null,
      latestQuote: { price: 118, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("RUNNING_WINNER");
  });

  it("UNPROTECTED_GAIN outranks a due review", () => {
    const result = computeNeedsAction({
      thesis: {
        ...ionsThesis,
        nextReviewAt: new Date("2026-05-01T00:00:00Z"), // overdue
      },
      latestUpdate: null,
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("UNPROTECTED_GAIN");
  });

  it("does NOT flag a non-held (WATCHING) row", () => {
    const result = computeNeedsAction({
      thesis: { ...ionsThesis, status: "WATCHING" },
      latestUpdate: null,
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });

  it("degrades gracefully when avgCost or the quote is missing", () => {
    expect(
      computeNeedsAction({
        thesis: { ...ionsThesis, avgCost: null },
        latestUpdate: null,
        latestQuote: { price: 86.24, changePct: 0 },
        now,
      }),
    ).toBeNull();
    expect(
      computeNeedsAction({
        thesis: ionsThesis,
        latestUpdate: null,
        latestQuote: null,
        now,
      }),
    ).toBeNull();
  });

  it("counts a trail as protection via peakPrice: tight trail → no flag", () => {
    const trail: Trigger = {
      id: "trig-trail",
      predicate: { kind: "TRAILING_FROM_HIGH", pct: 5 },
      action: "EXIT",
      rationale: "gain ratchet",
      cooldownDays: 0,
    };
    // peak 120, trail 5% → floor 114 locks +14; +18% gain → gap 4 → protected
    // (falls through to RUNNING_WINNER since target progress qualifies).
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        status: "HOLDING",
        triggers: [trail],
        avgCost: 100,
        peakPrice: 120,
        targetPrice: 130,
      },
      latestUpdate: null,
      latestQuote: { price: 118, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("RUNNING_WINNER");
  });
});

describe("computeNeedsAction — RUNNING_WINNER (SCALE_INTO_WINNERS.md PR3)", () => {
  // Since Game Plan PR-B, an unprotected winner surfaces as UNPROTECTED_GAIN
  // first (floor-first precedence) — so these fixtures carry a tight
  // protective floor (gap < 6pts at their quoted price) to exercise the
  // RUNNING_WINNER path specifically.
  const tightFloor = (level: number): Trigger => ({
    id: "trig-tight-floor",
    predicate: { kind: "PRICE_BELOW", level },
    action: "EXIT",
    rationale: "ratcheted floor",
    cooldownDays: 0,
  });
  const heldWinner = {
    ...baseThesis,
    status: "HOLDING",
    triggers: [] as Trigger[],
    avgCost: 100,
    targetPrice: 200,
  };

  it("flags a protected held winner at ≥75% progress with no trigger catching it", () => {
    const result = computeNeedsAction({
      thesis: { ...heldWinner, triggers: [tightFloor(175)] }, // locks +75 vs +80 gain
      latestUpdate: null,
      latestQuote: { price: 180, changePct: 0 }, // 80% of the way to target, +80%
      now,
    });
    expect(result?.kind).toBe("RUNNING_WINNER");
    if (result?.kind === "RUNNING_WINNER") {
      expect(result.unrealizedGainPct).toBeCloseTo(80);
      expect(result.progressToTarget).toBeCloseTo(0.8);
      expect(result.pastTarget).toBe(false);
    }
  });

  it("does NOT flag a protected held position below BOTH thresholds (mid-progress, modest gain)", () => {
    const result = computeNeedsAction({
      thesis: { ...heldWinner, triggers: [tightFloor(105)] }, // locks +5 vs +10 gain
      latestUpdate: null,
      latestQuote: { price: 110, changePct: 0 }, // 10% of the way, +10% gain — under 0.75 AND under the 12% floor
      now,
    });
    expect(result).toBeNull();
  });

  it("a fired EXIT trigger outranks RUNNING_WINNER", () => {
    const result = computeNeedsAction({
      thesis: { ...heldWinner, triggers: [EXIT_LONG] },
      latestUpdate: {
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-09T00:00:00Z"),
      },
      latestQuote: { price: 180, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
  });

  it("RUNNING_WINNER outranks a due review", () => {
    const result = computeNeedsAction({
      thesis: {
        ...heldWinner,
        triggers: [tightFloor(185)], // locks +85 vs +90 gain — protected
        nextReviewAt: new Date("2026-05-01T00:00:00Z"), // overdue
      },
      latestUpdate: null,
      latestQuote: { price: 190, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("RUNNING_WINNER");
  });

  it("does NOT flag a non-held (WATCHING) row", () => {
    const result = computeNeedsAction({
      thesis: { ...heldWinner, status: "WATCHING" },
      latestUpdate: null,
      latestQuote: { price: 190, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });

  it("does NOT flag when avgCost/target are absent (graceful degradation)", () => {
    const result = computeNeedsAction({
      thesis: { ...heldWinner, avgCost: null, targetPrice: null },
      latestUpdate: null,
      latestQuote: { price: 180, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });
});
