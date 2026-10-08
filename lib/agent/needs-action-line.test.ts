/**
 * needs-action-line.test.ts — the work-list flag, in words a person reads
 * (DAV-304).
 *
 * `needsAction` decides which stocks the daily run picks up, and until now it
 * was computed inside `get_theses`, handed to the model, and thrown away.
 * Nothing stored it, nothing rendered it, so Dave could not open a stock and
 * see whether its review flag had fired — the three defects found this month
 * (ETN/ISRG's capacity block, an event-date review that never fired, the
 * setup ask that never reached a quiet row) each took a hand-written database
 * query to find.
 *
 * Numbers below are live rows on 2026-09-22.
 */
import { computeNeedsAction } from "./needs-action";

/** The lead: the first entry on the stock's list, null when nothing is true. */
const leadOf = (...a: Parameters<typeof computeNeedsAction>) => computeNeedsAction(...a)[0] ?? null;
import { needsActionFlag } from "./needs-action-line";
import type { NeedsAction } from "./needs-action";
import type { Trigger } from "./triggers/types";

describe("the review flag says when it was due", () => {
  it("EME — reviewed 09-18 on a 7-day cadence, read on 09-29", () => {
    const na = leadOf({
      thesis: {
        id: "eme",
        direction: "LONG",
        status: "WATCHING",
        triggers: [
          {
            id: "t1",
            action: "REVIEW",
            predicate: { watch: "repeat", value: 7 },
            rationale: "weekly",
          } as unknown as Trigger,
        ],
        createdAt: new Date("2026-08-12T04:33:38.985Z"),
        lastReviewedAt: new Date("2026-09-18T12:06:51.288Z"),
      },
      now: new Date("2026-09-29T12:00:00Z"),
    });
    expect(na?.kind).toBe("REVIEW_DUE");
    expect(needsActionFlag(na!)).toEqual({ name: "Review due", detail: "3 days overdue" });
  });
});

/**
 * The sheet header's flag line. Dave asked whether this is "pure eligible
 * Flag Enums, no customization that complicates it" — these cases are the
 * answer: one name per kind, and at most one fact beside it.
 *
 * The union is a discriminated one because each kind genuinely knows
 * different things — REVIEW_DUE has no trigger to name, FLOOR_TOO_FAR has no
 * date. That shape is right; what was wrong was rendering all eight richly,
 * so every stock's header had a differently shaped sentence on it.
 */
describe("the flag is a name and at most one fact", () => {
  const cases: Array<[NeedsAction, string, string | null]> = [
    [
      { kind: "PROMOTED_AWAITING_RESOLUTION", paperTenureDays: null, paperRealizedPnl: null, paperReviewCount: null, promotedAt: null },
      "Promoted to live money",
      null,
    ],
    [
      { kind: "SALE_DECLINED", declineCount: 1, lastDeclinedAt: "2026-09-28T13:00:00.000Z", rejectMessage: null, floorPrice: 1041, recentLow: null },
      "Sale declined",
      "2026-09-28",
    ],
    [
      { kind: "SALE_DECLINED", declineCount: 3, lastDeclinedAt: "2026-09-28T13:00:00.000Z", rejectMessage: null, floorPrice: null, recentLow: null },
      "Sale declined",
      "3×, last 2026-09-28",
    ],
    [
      { kind: "TRIGGER_FIRED", triggerId: "t1", action: "REVIEW", summary: "Price below the 200-day", firedAt: "2026-09-29T13:40:00.000Z" },
      "Trigger fired",
      "Price below the 200-day",
    ],
    [
      { kind: "TRIGGER_MATCHING_NOW", triggerId: "t2", action: "ENTER", predicateSummary: "closes > $406", livePrice: 412.18 },
      "Trigger true now",
      "closes > $406",
    ],
    [
      { kind: "FLOOR_TOO_FAR", floorPrice: 248, avgCost: 276.9, quantity: 39, lossAtFloor: 1127, pctOfAccount: 2.14, structureBelow: [], line: "..." },
      "Floor too far",
      "2.1% of the account below here",
    ],
    [
      { kind: "UNPROTECTED_GAIN", unrealizedGainPct: 19.4, flooredGainPct: 4.2, unprotectedGapPct: 15.2, hasTrail: true, floorSummary: "25% off the high" },
      "Gain unprotected",
      "up 19%, floor locks 4%",
    ],
    [
      { kind: "UNPROTECTED_GAIN", unrealizedGainPct: 31, flooredGainPct: null, unprotectedGapPct: null, hasTrail: false, floorSummary: null },
      "Gain unprotected",
      "up 31%, no floor under it",
    ],
    [
      { kind: "RESEARCH_STALE", daysOld: null, threshold: 30, freshness: "missing" },
      "Research stale",
      "never written",
    ],
    [
      { kind: "RESEARCH_STALE", daysOld: 44, threshold: 30, freshness: "stale" },
      "Research stale",
      "44 days old",
    ],
    [{ kind: "REVIEW_DUE", daysOverdue: 0 }, "Review due", null],
    [{ kind: "REVIEW_DUE", daysOverdue: 1 }, "Review due", "1 day overdue"],
    [{ kind: "REVIEW_DUE", daysOverdue: 6 }, "Review due", "6 days overdue"],
    [
      { kind: "REVIEW_DUE", daysOverdue: 3, pendingFirstReview: true },
      "Review due",
      "never researched",
    ],
  ];

  it.each(cases)("%#", (na, name, detail) => {
    expect(needsActionFlag(na)).toEqual({ name, detail });
  });

  // The flag never carries a sentence. The paragraph under it is the
  // analyst's; the flag's job is to say which of eight things happened.
  it("a detail is a fact, never prose", () => {
    for (const [na] of cases) {
      const { detail } = needsActionFlag(na);
      if (detail == null) continue;
      expect(detail.length).toBeLessThan(45);
      expect(detail).not.toMatch(/\. /);
    }
  });
});
