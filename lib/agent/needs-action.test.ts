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
  createdAt: new Date("2026-04-01T00:00:00Z"),
  nextReviewAt: null as Date | null,
};

const now = new Date("2026-05-10T12:00:00Z");

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
