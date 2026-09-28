/**
 * complete-run-enter-resolution.test.ts — P1-40, the RARE gap.
 *
 * RARE's ENTER trigger fired 2026-08-05. The agent validated every
 * condition (price above the entry level, supportive news, Q2 beat),
 * wrote "validated, not entering," and `complete_run` went green. It was
 * the only shot — RARE never traded above that level again.
 *
 * The failure was not a missing gate. `unaddressed_theses` DID see the
 * thesis; it accepted a rationale-only REVIEW as resolution. Writing
 * about a fired ENTER counted as handling it.
 *
 * These pin the two bars: a REVIEWED row still resolves an ordinary
 * obligation, and no longer resolves an ENTER.
 */

const mockThesisFindMany = jest.fn();
const mockThesisUpdateFindMany = jest.fn();
const mockPositionFindMany = jest.fn().mockResolvedValue([]);
const mockRunFindUnique = jest.fn();
// The summary gate runs before the unaddressed-theses gate; a run_summary
// event has to exist or every case short-circuits there.
const mockRunEventFindFirst = jest
  .fn()
  .mockResolvedValue({ payload: { primary_decision: "HOLD" } });
const mockRunEventFindMany = jest.fn().mockResolvedValue([]);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findMany: mockThesisFindMany },
    thesisUpdate: { findMany: mockThesisUpdateFindMany },
    position: { findMany: mockPositionFindMany },
    researchRun: { findUnique: mockRunFindUnique },
    runEvent: { findFirst: mockRunEventFindFirst, findMany: mockRunEventFindMany },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({
  getStockQuote: jest.fn().mockResolvedValue({ c: 28.02, dp: 1.1 }),
}));
jest.mock("@/lib/proposals/pending-entry", () => ({
  getPendingEntryTickers: jest.fn().mockResolvedValue(new Set()),
}));
jest.mock("@/lib/agent/triggers/load-levels", () => ({
  loadLevelSources: jest.fn().mockResolvedValue(new Map()),
  resolveThesisLadder: jest.fn().mockReturnValue([]),
}));

import { __test__ } from "./complete-run";

const RUN_ID = "run_1";
const ANALYST_ID = "analyst_1";

/** A WATCHING thesis whose ENTER rung fired and is sitting unanswered. */
function firedEnterThesis() {
  const enterTrigger = {
    id: "trig_enter",
    predicate: { kind: "PRICE_ABOVE", level: 27.5 },
    action: "ENTER",
    rationale: "entry",
    cooldownDays: 1,
    lastFiredAt: new Date("2026-08-05T14:00:00Z").toISOString(),
  };
  return {
    id: "thesis_rare",
    ticker: "RARE",
    status: "WATCHING",
    direction: "LONG",
    triggers: [enterTrigger],
    createdAt: new Date("2026-07-01"),
    lastReviewedAt: null,
    promotedAt: null,
    paperTenureDays: null,
    paperRealizedPnl: null,
    paperReviewCount: null,
    updates: [
      {
        type: "TRIGGER_FIRED",
        triggerId: "trig_enter",
        timestamp: new Date("2026-08-05T14:00:00Z"),
      },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPositionFindMany.mockResolvedValue([]);
  mockRunFindUnique.mockResolvedValue({ status: "RUNNING" });
  mockRunEventFindFirst.mockResolvedValue({
    payload: { primary_decision: "HOLD" },
  });
  mockRunEventFindMany.mockResolvedValue([]);
  mockThesisFindMany.mockResolvedValue([firedEnterThesis()]);
});

describe("unaddressed_theses — a fired ENTER needs more than prose", () => {
  it("REFUSES when the only response was a rationale-only REVIEW", async () => {
    // The RARE shape verbatim.
    mockThesisUpdateFindMany.mockResolvedValue([
      { thesisId: "thesis_rare", type: "REVIEWED" },
    ]);

    const failure = await __test__.runCompleteRunPreflight(
      RUN_ID,
      ANALYST_ID,
      "DAILY",
    );
    expect(failure?.kind).toBe("unaddressed_theses");
    expect(failure?.message).toContain("RARE");
  });

  it("accepts a level change (UPDATED) — moving the bar is a real answer", async () => {
    mockThesisUpdateFindMany.mockResolvedValue([
      { thesisId: "thesis_rare", type: "UPDATED" },
    ]);
    expect(
      await __test__.runCompleteRunPreflight(RUN_ID, ANALYST_ID, "DAILY"),
    ).toBeNull();
  });

  it("accepts stopping the watch (STATUS_CHANGED)", async () => {
    mockThesisUpdateFindMany.mockResolvedValue([
      { thesisId: "thesis_rare", type: "STATUS_CHANGED" },
    ]);
    expect(
      await __test__.runCompleteRunPreflight(RUN_ID, ANALYST_ID, "DAILY"),
    ).toBeNull();
  });

  it("still refuses when nothing at all was written", async () => {
    mockThesisUpdateFindMany.mockResolvedValue([]);
    const failure = await __test__.runCompleteRunPreflight(
      RUN_ID,
      ANALYST_ID,
      "DAILY",
    );
    expect(failure?.kind).toBe("unaddressed_theses");
  });

  it("names the escape hatches in the refusal", async () => {
    mockThesisUpdateFindMany.mockResolvedValue([
      { thesisId: "thesis_rare", type: "REVIEWED" },
    ]);
    const failure = await __test__.runCompleteRunPreflight(
      RUN_ID,
      ANALYST_ID,
      "DAILY",
    );
    expect(failure?.message).toContain("place_trade");
    expect(failure?.message).toContain("fired ENTER");
  });
});

describe("unaddressed_theses — everything else keeps the weaker bar", () => {
  it("a REVIEWED row still resolves a non-ENTER obligation", async () => {
    // Same thesis, but the fired rung is a REVIEW. Looking IS the work
    // there, so prose remains a valid answer — this is the behavior the
    // P1-40 fix must not break.
    const t = firedEnterThesis();
    t.triggers[0].action = "REVIEW";
    t.status = "HOLDING";
    mockThesisFindMany.mockResolvedValue([t]);
    mockThesisUpdateFindMany.mockResolvedValue([
      { thesisId: "thesis_rare", type: "REVIEWED" },
    ]);

    expect(
      await __test__.runCompleteRunPreflight(RUN_ID, ANALYST_ID, "DAILY"),
    ).toBeNull();
  });
});
