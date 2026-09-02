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

const now = new Date("2026-05-10T12:00:00Z");

const baseThesis = {
  id: "thesis-1",
  // Committed direction by default — the production caller always passes the
  // DB value (string | null, never undefined). Seed-specific tests override
  // with direction: null / "PENDING" to exercise the pendingFirstReview path
  // (P1-24 B4). A committed default keeps the generic REVIEW_DUE tests from
  // accidentally tripping the seed discriminator.
  direction: "LONG" as string | null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  lastReviewedAt: null as Date | null,
};

/**
 * "Review every 7 days" — the account's standing cadence. Since DAV-195 L7
 * this trigger IS the review clock; the cached date column is gone (DAV-221)
 * and every surface derives the due date from lastReviewedAt + this.
 */
const CADENCE_7D: Trigger = {
  id: "trig-cadence",
  predicate: { kind: "REVIEW_CADENCE", days: 7 },
  action: "REVIEW",
  rationale: "Look at this every 7 days.",
  cooldownDays: 7,
};

/** A thesis last looked at `days` ago. */
const lookedAt = (days: number) =>
  new Date(now.getTime() - days * 86_400_000);

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
  it("returns REVIEW_DUE once the cadence has elapsed", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(11),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 4 });
  });

  it("flags pendingFirstReview on a null-direction seed (P1-24 B4)", () => {
    // An unresearched watchlist seed now stores direction=null and is minted
    // with a cadence trigger + null lastReviewedAt (falls back to createdAt),
    // so it surfaces as REVIEW_DUE within a cadence; the null-direction
    // discriminator must set pendingFirstReview so the prompt routes it to
    // the "commit a direction" path (exactly as legacy 'PENDING' did).
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        direction: null,
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(11),
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
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(11),
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
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(11),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 4 });
  });

  it("returns null while still inside the cadence window", () => {
    // Reviewed yesterday on a 7-day cadence — due again in 6 days.
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(1),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });

  it("returns null when no cadence is set and no triggers fire", () => {
    const result = computeNeedsAction({
      thesis: { ...baseThesis, triggers: [] },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });

  // Anti-regression for the 2026-05-20 NVDA case: morning daily-run at
  // 08:00 ET (12:00 UTC) needs to catch a thesis whose review comes due
  // later TODAY (e.g. 09:30 ET = 13:30 UTC). Before the look-ahead
  // window was added, this returned null and the trigger evaluator's
  // REVIEW_DATE_HIT cron picked it up 90 min later in a redundant
  // tactical run.
  it("returns REVIEW_DUE when the review comes due later TODAY", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        // now = 12:00 UTC; this is 13:30 UTC same day (90 min ahead)
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(6.94),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 0 });
  });

  it("returns daysOverdue: 0 when the review is due within 24h", () => {
    // now = 12:00 UTC; due date = +23h
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: new Date(now.getTime() - 6 * 86_400_000 - 3_600_000),
      },
      latestUpdate: null,
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 0 });
  });

  it("returns null when the review is just past the 24h look-ahead", () => {
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: new Date(now.getTime() - 5 * 86_400_000 - 23 * 3_600_000),
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
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(11),
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
    // Both are live: the price trigger matches AND the review is 4 days
    // overdue. The specific thing that happened outranks the routine look.
    const result = computeNeedsAction({
      thesis: {
        ...baseThesis,
        triggers: [ENTER_LONG, CADENCE_7D],
        lastReviewedAt: lookedAt(11),
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
    targetPrice: null as number | null,
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

  it("UNPROTECTED_GAIN fires on a big unprotected winner", () => {
    // avgCost 100, target 120, price 118: a big winner (progress 0.9,
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

  it("a protected winner raises no unprotected-gain flag", () => {
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
    // Falls through to no flag at all. It used to fall through to
    // RUNNING_WINNER, which was deleted (DAV-195 L8) — the account's "review
    // if up 10% from entry" trigger fires on this position first anyway, and
    // the row carries its own gain % for the agent to read. What matters
    // here is unchanged: a PROTECTED winner does not raise UNPROTECTED_GAIN.
    expect(result?.kind).not.toBe("UNPROTECTED_GAIN");
  });

  it("UNPROTECTED_GAIN outranks a due review", () => {
    const result = computeNeedsAction({
      thesis: {
        ...ionsThesis,
        triggers: [ionsExit, CADENCE_7D],
        lastReviewedAt: lookedAt(11), // review overdue by 4 days
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

  it("counts a trail as protection via peakPrice: tight trail raises no flag", () => {
    const trail: Trigger = {
      id: "trig-trail",
      predicate: { kind: "TRAILING_FROM_HIGH", pct: 5 },
      action: "EXIT",
      rationale: "gain ratchet",
      cooldownDays: 0,
    };
    // peak 120, trail 5% → floor 114 locks +14; +18% gain → gap 4 → protected
    // (no flag — the gain is protected).
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
    // Falls through to no flag at all. It used to fall through to
    // RUNNING_WINNER, which was deleted (DAV-195 L8) — the account's "review
    // if up 10% from entry" trigger fires on this position first anyway, and
    // the row carries its own gain % for the agent to read. What matters
    // here is unchanged: a PROTECTED winner does not raise UNPROTECTED_GAIN.
    expect(result?.kind).not.toBe("UNPROTECTED_GAIN");
  });
});


// ── RESEARCH_STALE (2026-08-31) ───────────────────────────────────────────
// The gap this closes: `researchAge` has ridden on every thesis row since
// P1-1, but only the REVIEW_DUE branch consulted it. A compounder watch on
// a 30-day clock reviewed on day 0 carried "stale" research silently for
// the next month. Being computed rather than fired is no reason to stay
// invisible — UNPROTECTED_GAIN is computed too.
describe("computeNeedsAction — RESEARCH_STALE", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const freshClock = (days: number): Trigger[] => [
    {
      id: "clock",
      predicate: { kind: "REVIEW_CADENCE", days },
      action: "REVIEW",
      rationale: "cadence",
    } as Trigger,
  ];

  it("flags an 80-day-old compounder watch whose review is a month away (the GD case)", () => {
    const result = computeNeedsAction({
      thesis: {
        id: "t1",
        direction: "LONG",
        status: "WATCHING",
        horizon: "COMPOUNDER",
        triggers: freshClock(30),
        createdAt: daysAgo(200),
        lastReviewedAt: daysAgo(0), // reviewed today — no review is due
        researchUpdatedAt: daysAgo(80),
      },
      latestUpdate: null,
      latestQuote: null,
      now: new Date(),
    });
    expect(result?.kind).toBe("RESEARCH_STALE");
    if (result?.kind !== "RESEARCH_STALE") return;
    expect(result.daysOld).toBe(80);
    expect(result.threshold).toBe(35);
  });

  it("does NOT flag the same age on a stock we own — held names keep the longer clock", () => {
    const result = computeNeedsAction({
      thesis: {
        id: "t2",
        direction: "LONG",
        status: "HOLDING",
        horizon: "COMPOUNDER",
        triggers: freshClock(30),
        createdAt: daysAgo(200),
        lastReviewedAt: daysAgo(0),
        researchUpdatedAt: daysAgo(80),
      },
      latestUpdate: null,
      latestQuote: null,
      now: new Date(),
    });
    expect(result).toBeNull();
  });

  it("a due review still wins — REVIEW_DUE carries the staleness instruction already", () => {
    const result = computeNeedsAction({
      thesis: {
        id: "t3",
        direction: "LONG",
        status: "WATCHING",
        horizon: "COMPOUNDER",
        triggers: freshClock(30),
        createdAt: daysAgo(200),
        lastReviewedAt: daysAgo(40), // overdue
        researchUpdatedAt: daysAgo(80),
      },
      latestUpdate: null,
      latestQuote: null,
      now: new Date(),
    });
    expect(result?.kind).toBe("REVIEW_DUE");
  });

  it("fresh research on a quiet row stays quiet", () => {
    const result = computeNeedsAction({
      thesis: {
        id: "t4",
        direction: "LONG",
        status: "WATCHING",
        horizon: "COMPOUNDER",
        triggers: freshClock(30),
        createdAt: daysAgo(200),
        lastReviewedAt: daysAgo(0),
        researchUpdatedAt: daysAgo(10),
      },
      latestUpdate: null,
      latestQuote: null,
      now: new Date(),
    });
    expect(result).toBeNull();
  });

  it("a thesis with no deep research at all is flagged as missing", () => {
    const result = computeNeedsAction({
      thesis: {
        id: "t5",
        direction: "LONG",
        status: "WATCHING",
        horizon: "TARGET",
        triggers: freshClock(30),
        createdAt: daysAgo(200),
        lastReviewedAt: daysAgo(0),
        researchUpdatedAt: null,
      },
      latestUpdate: null,
      latestQuote: null,
      now: new Date(),
    });
    expect(result?.kind).toBe("RESEARCH_STALE");
    if (result?.kind !== "RESEARCH_STALE") return;
    expect(result.freshness).toBe("missing");
  });

  it("never nags a quiet watch — no view, no clock, nothing that could satisfy it", () => {
    // The interaction bug: a bare name added with attention:"quiet" has no
    // review clock and no research, so without this exclusion it would flag
    // RESEARCH_STALE("missing") every morning forever — turning the one
    // tier that exists to cost nothing into permanent work.
    const result = computeNeedsAction({
      thesis: {
        id: "t7",
        direction: null,
        status: "WATCHING",
        horizon: null,
        triggers: [
          {
            id: "wake",
            predicate: { kind: "PRICE_BELOW", level: 24 },
            action: "REVIEW",
            rationale: "wake",
          } as Trigger,
        ],
        createdAt: daysAgo(120),
        lastReviewedAt: null,
        researchUpdatedAt: null,
      },
      latestUpdate: null,
      latestQuote: null,
      now: new Date(),
    });
    expect(result).toBeNull();
  });

  it("an unresearched seed is not 'stale' — it surfaces as REVIEW_DUE asking for first research", () => {
    const result = computeNeedsAction({
      thesis: {
        id: "t8",
        direction: null,
        status: "WATCHING",
        horizon: null,
        triggers: freshClock(7),
        createdAt: daysAgo(30),
        lastReviewedAt: null,
        researchUpdatedAt: null,
      },
      latestUpdate: null,
      latestQuote: null,
      now: new Date(),
    });
    expect(result?.kind).toBe("REVIEW_DUE");
    if (result?.kind !== "REVIEW_DUE") return;
    expect(result.pendingFirstReview).toBe(true);
  });

  it("callers that don't pass researchUpdatedAt keep their old behavior", () => {
    const result = computeNeedsAction({
      thesis: {
        id: "t6",
        direction: "LONG",
        status: "WATCHING",
        horizon: "COMPOUNDER",
        triggers: freshClock(30),
        createdAt: daysAgo(200),
        lastReviewedAt: daysAgo(0),
      },
      latestUpdate: null,
      latestQuote: null,
      now: new Date(),
    });
    expect(result).toBeNull();
  });
});
