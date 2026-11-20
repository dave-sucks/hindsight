/**
 * computeNeedsAction — trigger-driven only. NEAR_TARGET / NEAR_STOP /
 * ENTRY_MET are NOT valid kinds (those would be hardcoded-threshold
 * heuristics, exactly the parallel-logic bug Fix #0 removes).
 */

import { computeNeedsAction } from "./needs-action";

/** The lead: the first entry on the stock's list, null when nothing is true. */
const leadOf = (...a: Parameters<typeof computeNeedsAction>) => computeNeedsAction(...a)[0] ?? null;
import type { Trigger } from "./triggers/types";

const ENTER_LONG: Trigger = {
  id: "trig-enter",
  predicate: { watch: "price", is: "above", value: 100 },
  action: "ENTER",
  rationale: "Entry on breakout",
};

const EXIT_LONG: Trigger = {
  id: "trig-exit",
  predicate: { watch: "price", is: "below", value: 90 },
  action: "EXIT",
  rationale: "Stop at 90",
};

const REVIEW_HYGIENE: Trigger = {
  id: "trig-review",
  predicate: { watch: "repeat", value: 30 },
  action: "REVIEW",
  rationale: "Monthly hygiene",
};

const SIGNAL_EARNINGS: Trigger = {
  id: "trig-earnings",
  predicate: { watch: "surprise", is: "beat", value: 0 },
  action: "REVIEW",
  rationale: "Earnings beat",
};

const now = new Date("2026-05-10T12:00:00Z");

const baseThesis = {
  id: "thesis-1",
  // Committed direction by default — the production caller always passes the
  // DB value (string | null, never undefined). Seed-specific tests override
  // with direction: null: a watch with no view, which carries no flag
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
  predicate: { watch: "repeat", value: 7 },
  action: "REVIEW",
  rationale: "Look at this every 7 days.",
};

/** A thesis last looked at `days` ago. */
const lookedAt = (days: number) =>
  new Date(now.getTime() - days * 86_400_000);

describe("computeNeedsAction — PROMOTED_AWAITING_RESOLUTION (top precedence)", () => {
  it("returns PROMOTED_AWAITING_RESOLUTION when status is PROMOTED, regardless of trigger state", () => {
    const result = leadOf({
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
      activity: [{
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      }],
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
    const result = leadOf({
      thesis: {
        ...baseThesis,
        status: "PROMOTED",
        triggers: [],
      },
      activity: [],
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
    const result = leadOf({
      thesis: {
        ...baseThesis,
        status: "WATCHING",
        triggers: [],
      },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });
});

describe("computeNeedsAction — pending entry proposal suppresses ENTER (P1-25 Change 4)", () => {
  it("suppresses a fired ENTER trigger when a buy proposal is pending", () => {
    const result = leadOf({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [ENTER_LONG] },
      activity: [{
        type: "TRIGGER_FIRED",
        triggerId: "trig-enter",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      }],
      latestQuote: { price: 120, changePct: 0 },
      now,
      hasPendingEntryProposal: true,
    });
    expect(result).toBeNull();
  });

  it("suppresses a matching-now ENTER predicate when a buy proposal is pending", () => {
    const result = leadOf({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [ENTER_LONG] },
      activity: [],
      latestQuote: { price: 120, changePct: 0 }, // above 100 → ENTER matches
      now,
      hasPendingEntryProposal: true,
    });
    expect(result).toBeNull();
  });

  it("still surfaces a fired EXIT trigger when a buy proposal is pending (only ENTER suppressed)", () => {
    const result = leadOf({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [EXIT_LONG] },
      activity: [{
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      }],
      latestQuote: { price: 80, changePct: 0 },
      now,
      hasPendingEntryProposal: true,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
  });

  it("surfaces the ENTER normally when no proposal is pending", () => {
    const result = leadOf({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [ENTER_LONG] },
      activity: [{
        type: "TRIGGER_FIRED",
        triggerId: "trig-enter",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      }],
      latestQuote: { price: 120, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
    if (result && result.kind === "TRIGGER_FIRED") {
      expect(result.action).toBe("ENTER");
    }
  });
});

describe("computeNeedsAction — a sale waiting for the principal silences only that sale", () => {
  const TRIM_LONG: Trigger = { id: "trig-trim", predicate: { watch: "price", is: "above", value: 150 }, action: "TRIM", rationale: "Trim into strength"};
  const ADD_LONG: Trigger = { id: "trig-add", predicate: { watch: "price", is: "above", value: 150 }, action: "ADD", rationale: "Press the winner"};
  const REVIEW_PRICE: Trigger = { id: "trig-review-price", predicate: { watch: "price", is: "below", value: 95 }, action: "REVIEW", rationale: "Look if it slips"};
  const held = (triggers: Trigger[]) => ({ ...baseThesis, status: "HOLDING", triggers });
  const fired = (triggerId: string, at = "2026-05-10T09:00:00Z") => ({ type: "TRIGGER_FIRED", triggerId, timestamp: new Date(at) });
  /** The kinds on the list, lead first, and the sale's action wherever a fire carries it. */
  const kinds = (r: ReturnType<typeof computeNeedsAction>) => r.map((f) => f.kind);

  it("a fired sale is not raised again while its card waits, and is the lead without the card", () => {
    const input = { thesis: held([EXIT_LONG]), activity: [fired("trig-exit")], latestQuote: { price: 80, changePct: 0 }, now };
    expect(computeNeedsAction({ ...input, hasPendingSaleProposal: true })).toEqual([]);
    expect(leadOf(input)?.kind).toBe("TRIGGER_FIRED");
  });

  it("a sale true now, and a fired trim, are the card's too", () => {
    const now80 = { latestQuote: { price: 80, changePct: 0 }, now };
    expect(computeNeedsAction({ thesis: held([EXIT_LONG]), activity: [], ...now80, hasPendingSaleProposal: true })).toEqual([]);
    expect(leadOf({ thesis: held([EXIT_LONG]), activity: [], ...now80 })?.kind).toBe("TRIGGER_MATCHING_NOW");

    const high = { latestQuote: { price: 160, changePct: 0 }, now };
    expect(computeNeedsAction({ thesis: held([TRIM_LONG]), activity: [fired("trig-trim")], ...high, hasPendingSaleProposal: true })).toEqual([]);
    expect(leadOf({ thesis: held([TRIM_LONG]), activity: [fired("trig-trim")], ...high })?.kind).toBe("TRIGGER_FIRED");
  });

  it("a sale the principal declined before is not raised beside a new card", () => {
    const declinedSale = { declineCount: 1, lapseCount: 0, lastDeclinedAt: "2026-05-09T15:00:00Z", rejectMessage: "not yet", floorPrice: 90, recentLow: 82 };
    const input = { thesis: held([EXIT_LONG]), activity: [], latestQuote: { price: 80, changePct: 0 }, now, declinedSale };
    expect(leadOf(input)?.kind).toBe("SALE_DECLINED");
    expect(computeNeedsAction({ ...input, hasPendingSaleProposal: true })).toEqual([]);
  });

  it("a review that fired beside the sale, and the review clock, still list the stock", () => {
    const input = {
      thesis: { ...held([EXIT_LONG, REVIEW_PRICE, CADENCE_7D]), lastReviewedAt: lookedAt(10) },
      activity: [fired("trig-exit"), fired("trig-review-price")],
      latestQuote: { price: 80, changePct: 0 },
      now,
    };
    // Without the card: the sale leads, with the review fired beside it.
    const without = computeNeedsAction(input);
    expect(without[0]).toMatchObject({ kind: "TRIGGER_FIRED", action: "EXIT", alsoFired: [{ triggerId: "trig-review-price", action: "REVIEW" }] });

    // With it: the review leads, carries no sale beside it, and the clock is still due.
    const waiting = computeNeedsAction({ ...input, hasPendingSaleProposal: true });
    expect(waiting[0]).toMatchObject({ kind: "TRIGGER_FIRED", triggerId: "trig-review-price", action: "REVIEW" });
    expect(waiting[0]).not.toHaveProperty("alsoFired");
    // The review is still under its line and out of its wait, so it is also true now.
    expect(kinds(waiting)).toEqual(["TRIGGER_FIRED", "TRIGGER_MATCHING_NOW", "REVIEW_DUE"]);
  });

  it("an add that fired, and a review that came due, are not the sale's: still listed", () => {
    const addFired = computeNeedsAction({ thesis: held([ADD_LONG]), activity: [fired("trig-add")], latestQuote: { price: 160, changePct: 0 }, now, hasPendingSaleProposal: true });
    expect(addFired[0]).toMatchObject({ kind: "TRIGGER_FIRED", action: "ADD" });

    const due = computeNeedsAction({ thesis: { ...held([CADENCE_7D]), lastReviewedAt: lookedAt(10) }, activity: [], latestQuote: { price: 100, changePct: 0 }, now, hasPendingSaleProposal: true });
    expect(kinds(due)).toEqual(["REVIEW_DUE"]);
  });
});

describe("computeNeedsAction — TRIGGER_FIRED precedence", () => {
  it("returns TRIGGER_FIRED when latest ThesisUpdate is an unanswered fire", () => {
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      activity: [{
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      }],
      latestQuote: { price: 80, changePct: 0 },
      now,
    });
    expect(result).toEqual({
      kind: "TRIGGER_FIRED",
      triggerId: "trig-exit",
      action: "EXIT",
      summary: "Sell if below $90",
      firedAt: "2026-05-10T09:00:00.000Z",
    });
  });

  it("includes a graceful fallback when the firing triggerId was deleted", () => {
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      activity: [{
        type: "TRIGGER_FIRED",
        triggerId: "ghost-trigger",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      }],
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
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      activity: [{
        type: "UPDATED",
        triggerId: null,
        timestamp: new Date("2026-05-10T09:00:00Z"),
      }],
      latestQuote: { price: 80, changePct: 0 }, // below stop
      now,
    });
    expect(result?.kind).toBe("TRIGGER_MATCHING_NOW");
  });
});

describe("computeNeedsAction — TRIGGER_MATCHING_NOW", () => {
  it("returns TRIGGER_MATCHING_NOW when a price predicate is currently true", () => {
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [ENTER_LONG] },
      activity: [],
      latestQuote: { price: 105, changePct: 1 },
      now,
    });
    expect(result).toEqual({
      kind: "TRIGGER_MATCHING_NOW",
      triggerId: "trig-enter",
      action: "ENTER",
      predicateSummary: "Buy if above $100",
      livePrice: 105,
    });
  });

  it("returns null when no predicate matches", () => {
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [ENTER_LONG, EXIT_LONG] },
      activity: [],
      latestQuote: { price: 95, changePct: 0 }, // between stop and entry-trigger
      now,
    });
    expect(result).toBeNull();
  });

  it("skips signal-side predicates (no signal payload available at run-start)", () => {
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [SIGNAL_EARNINGS] },
      activity: [],
      latestQuote: { price: 100, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });

  it("does not fire when the quote is missing (price-side eval needs a quote)", () => {
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });
});

describe("computeNeedsAction — REVIEW_DUE", () => {
  it("returns REVIEW_DUE once the cadence has elapsed", () => {
    const result = leadOf({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(11),
      },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 4 });
  });

  it("a watch with no view carries no flag when its clock comes due: code sends it to the Writer", () => {
    const seed = { thesis: { ...baseThesis, status: "WATCHING", direction: null, triggers: [CADENCE_7D], lastReviewedAt: lookedAt(11) }, activity: [], latestQuote: null, now };
    expect(computeNeedsAction(seed)).toEqual([]);
    // The same watch with a view is due.
    expect(leadOf({ ...seed, thesis: { ...seed.thesis, direction: "LONG" } })).toEqual({ kind: "REVIEW_DUE", daysOverdue: 4 });
  });

  it("a committed LONG that is REVIEW_DUE is the flag and its days", () => {
    const result = leadOf({
      thesis: {
        ...baseThesis,
        direction: "LONG",
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(11),
      },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 4 });
  });

  it("returns null while still inside the cadence window", () => {
    // Reviewed yesterday on a 7-day cadence — due again in 6 days.
    const result = leadOf({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(1),
      },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });

  it("returns null when no cadence is set and no triggers fire", () => {
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [] },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });

  // Anti-regression for the 2026-05-20 NVDA case: morning daily-run at
  // 08:00 ET (12:00 UTC) needs to catch a thesis whose review comes due
  // later TODAY (e.g. 09:30 ET = 13:30 UTC). Before the look-ahead
  // window was added, this returned null and the trigger evaluator's
  // old review-date trigger cron picked it up 90 min later in a redundant
  // tactical run.
  it("returns REVIEW_DUE when the review comes due later TODAY", () => {
    const result = leadOf({
      thesis: {
        ...baseThesis,
        // now = 12:00 UTC; this is 13:30 UTC same day (90 min ahead)
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(6.94),
      },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 0 });
  });

  it("returns daysOverdue: 0 when the review is due within 24h", () => {
    // now = 12:00 UTC; due date = +23h
    const result = leadOf({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: new Date(now.getTime() - 6 * 86_400_000 - 3_600_000),
      },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toEqual({ kind: "REVIEW_DUE", daysOverdue: 0 });
  });

  it("returns null when the review is just past the 24h look-ahead", () => {
    const result = leadOf({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: new Date(now.getTime() - 5 * 86_400_000 - 23 * 3_600_000),
      },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });
});

describe("computeNeedsAction — precedence (FIRED > MATCHING_NOW > REVIEW_DUE)", () => {
  it("FIRED beats MATCHING_NOW + REVIEW_DUE", () => {
    const result = leadOf({
      thesis: {
        ...baseThesis,
        triggers: [CADENCE_7D],
        lastReviewedAt: lookedAt(11),
      },
      activity: [{
        type: "TRIGGER_FIRED",
        triggerId: "trig-exit",
        timestamp: new Date("2026-05-10T08:00:00Z"),
      }],
      latestQuote: { price: 80, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
  });

  it("MATCHING_NOW beats REVIEW_DUE", () => {
    // Both are live: the price trigger matches AND the review is 4 days
    // overdue. The specific thing that happened outranks the routine look.
    const result = leadOf({
      thesis: {
        ...baseThesis,
        triggers: [ENTER_LONG, CADENCE_7D],
        lastReviewedAt: lookedAt(11),
      },
      activity: [],
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
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      activity: [],
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
    const result = leadOf({
      thesis: { ...baseThesis, triggers: [EXIT_LONG] },
      activity: [],
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
    predicate: { watch: "price", is: "below", value: 65 },
    action: "EXIT",
    rationale: "day-one stop",
  };
  const ionsThesis = {
    ...baseThesis,
    status: "HOLDING",
    triggers: [ionsExit],
    avgCost: 73.83,
  };

  it("flags a +17% holding whose floor locks −12% (the IONS shape)", () => {
    const result = leadOf({
      thesis: ionsThesis,
      activity: [],
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("UNPROTECTED_GAIN");
    if (result?.kind === "UNPROTECTED_GAIN") {
      expect(result.unrealizedGainPct).toBeCloseTo(16.81, 1);
      expect(result.flooredGainPct).toBeCloseTo(-11.96, 1);
      expect(result.unprotectedGapPct).toBeCloseTo(28.77, 1);
      expect(result.hasTrail).toBe(false);
      expect(result.floorSummary).toContain("$65");
    }
  });

  it("flags a qualifying gain with NO protective EXIT rung at all", () => {
    const result = leadOf({
      thesis: { ...ionsThesis, triggers: [] },
      activity: [],
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
      predicate: { watch: "price", is: "below", value: 82 }, // locks +11.1% vs +16.8% gain
    };
    const result = leadOf({
      thesis: { ...ionsThesis, triggers: [raisedFloor] },
      activity: [],
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });

  it("a fired EXIT trigger outranks UNPROTECTED_GAIN", () => {
    const result = leadOf({
      thesis: ionsThesis,
      activity: [{
        type: "TRIGGER_FIRED",
        triggerId: "trig-ions-floor",
        timestamp: new Date("2026-05-10T09:00:00Z"),
      }],
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("TRIGGER_FIRED");
  });

  it("a matching-now predicate outranks UNPROTECTED_GAIN", () => {
    const addRung: Trigger = {
      id: "trig-add",
      predicate: { watch: "price", is: "above", value: 85 },
      action: "ADD",
      rationale: "breakout add",
    };
    const result = leadOf({
      thesis: { ...ionsThesis, triggers: [ionsExit, addRung] },
      activity: [],
      latestQuote: { price: 86.24, changePct: 0 }, // above 85 → ADD matches
      now,
    });
    expect(result?.kind).toBe("TRIGGER_MATCHING_NOW");
  });

  it("UNPROTECTED_GAIN fires on a big unprotected winner", () => {
    // avgCost 100, target 120, price 118: a big winner (progress 0.9,
    // +18%) — but there's no floor, so UNPROTECTED_GAIN must win.
    const result = leadOf({
      thesis: {
        ...baseThesis,
        status: "HOLDING",
        triggers: [],
        avgCost: 100,
      },
      activity: [],
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
      predicate: { watch: "price", is: "below", value: 114 },
      action: "EXIT",
      rationale: "ratcheted floor",
    };
    const result = leadOf({
      thesis: {
        ...baseThesis,
        status: "HOLDING",
        triggers: [tightFloor],
        avgCost: 100,
      },
      activity: [],
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
    const result = leadOf({
      thesis: {
        ...ionsThesis,
        triggers: [ionsExit, CADENCE_7D],
        lastReviewedAt: lookedAt(11), // review overdue by 4 days
      },
      activity: [],
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result?.kind).toBe("UNPROTECTED_GAIN");
  });

  it("does NOT flag a non-held (WATCHING) row", () => {
    const result = leadOf({
      thesis: { ...ionsThesis, status: "WATCHING" },
      activity: [],
      latestQuote: { price: 86.24, changePct: 0 },
      now,
    });
    expect(result).toBeNull();
  });

  it("degrades gracefully when avgCost or the quote is missing", () => {
    expect(
      leadOf({
        thesis: { ...ionsThesis, avgCost: null },
        activity: [],
        latestQuote: { price: 86.24, changePct: 0 },
        now,
      }),
    ).toBeNull();
    expect(
      leadOf({
        thesis: ionsThesis,
        activity: [],
        latestQuote: null,
        now,
      }),
    ).toBeNull();
  });

  it("counts a trail as protection via peakPrice: tight trail raises no flag", () => {
    const trail: Trigger = {
      id: "trig-trail",
      predicate: { watch: "move", is: "below", value: 5, variable: "peak" },
      action: "EXIT",
      rationale: "gain ratchet",
    };
    // peak 120, trail 5% → floor 114 locks +14; +18% gain → gap 4 → protected
    // (no flag — the gain is protected).
    const result = leadOf({
      thesis: {
        ...baseThesis,
        status: "HOLDING",
        triggers: [trail],
        avgCost: 100,
        peakPrice: 120,
      },
      activity: [],
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


// Old research is not work by itself (2026-11-13: the "research stale" flag
// was deleted). WST on 2026-11-13: research 65 days old, reviewed on its own
// clock, nothing fired — it came back every morning and never cleared.
describe("computeNeedsAction — old research alone puts nothing on the list", () => {
  it("an 80-day-old compounder watch reviewed today, nothing fired: no flag", () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    const clock = { id: "clock", predicate: { watch: "repeat", value: 30 }, action: "REVIEW", rationale: "cadence" } as Trigger;
    const result = leadOf({
      thesis: { id: "t1", direction: "LONG", status: "WATCHING", triggers: [clock], createdAt: daysAgo(200), lastReviewedAt: daysAgo(0) },
      activity: [],
      latestQuote: null,
      now: new Date(),
    });
    expect(result).toBeNull();
  });
});

describe("computeNeedsAction — a day count from the buy is not the review clock", () => {
  // "Review 60 days after the buy" is an ordinary trigger: it fires through
  // the evaluator and arrives as TRIGGER_FIRED. It must not make the row
  // REVIEW_DUE on its own, and it must not be mistaken for a review cadence.
  const SIXTY_AFTER_BUY: Trigger = {
    id: "trig-sixty",
    predicate: { watch: "from_date", is: "after", value: 60, variable: "buy" },
    action: "REVIEW",
    rationale: "The 60-day business checkpoint.",
  };
  it("a watch with only a buy-count review and no clock is quiet", () => {
    const result = leadOf({
      thesis: { ...baseThesis, status: "WATCHING", triggers: [SIXTY_AFTER_BUY], lastReviewedAt: lookedAt(90) },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result).toBeNull();
  });
  it("the review clock next to it still decides REVIEW_DUE", () => {
    const result = leadOf({
      thesis: { ...baseThesis, status: "HOLDING", triggers: [SIXTY_AFTER_BUY, CADENCE_7D], lastReviewedAt: lookedAt(8) },
      activity: [],
      latestQuote: null,
      now,
    });
    expect(result?.kind).toBe("REVIEW_DUE");
  });
});
