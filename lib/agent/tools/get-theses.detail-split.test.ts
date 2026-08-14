/**
 * get-theses.detail-split.test.ts — the 2026-08-13 morning-cost fix.
 *
 * The trigger-gated daily-run design says only fired/due theses get
 * reviewed — but get_theses shipped the FULL book (~4k tokens/thesis) on
 * the morning run's opening read, and that payload rode in the model's
 * context for every subsequent step (measured: 21 theses → ~91k tokens →
 * ~820k of a 1.03M-token run). These tests pin the fix: on an unfiltered
 * MORNING_PLAN read, quiet rows (needsAction=null, non-PROMOTED) collapse
 * to one-line index entries in `quiet_theses`; work-list rows stay full.
 * Explicit filters and every other run mode keep the full-book behavior.
 */

const mockThesisFindMany = jest.fn();
const mockThesisUpdateFindMany = jest.fn().mockResolvedValue([]);
const mockPositionFindMany = jest.fn().mockResolvedValue([]);
const mockOrderFindMany = jest.fn().mockResolvedValue([]);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findMany: mockThesisFindMany },
    thesisUpdate: { findMany: mockThesisUpdateFindMany },
    position: { findMany: mockPositionFindMany },
    order: { findMany: mockOrderFindMany },
  },
}));
jest.mock("@/lib/alpaca", () => ({
  getLatestPrices: jest.fn().mockResolvedValue({}),
  // P1-39: daily bars for the HELD_THROUGH_FLOOR recent-low fetch.
  getBars: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/proposals/pending-entry", () => ({
  getPendingEntryTickers: jest.fn().mockResolvedValue(new Set()),
}));

import { getTheses } from "./get-theses";
import { getBars, getLatestPrices } from "@/lib/alpaca";
import type { ToolContext } from "@/lib/agent/tool-context";

const mockGetLatestPrices = getLatestPrices as jest.Mock;
const mockGetBars = getBars as jest.Mock;

function makeCtx(runMode?: string): ToolContext {
  return {
    runId: "run_1",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    runMode,
    groupId: (p: string) => p,
  } as unknown as ToolContext;
}

function thesisRow(over: Record<string, unknown>) {
  return {
    id: "t1",
    ticker: "AAA",
    direction: "LONG",
    status: "WATCHING",
    horizon: "TARGET",
    coreBelief: "Belief sentence.",
    snapshot: { text: "snapshot text", citations: [] },
    bullCase: { bullets: [{ text: "bull 1" }] },
    bearCase: { bullets: [{ text: "bear 1" }] },
    keyAssumptions: ["a1", "a2"],
    invalidationConds: ["i1", "i2"],
    entryPrice: 100,
    targetPrice: 130,
    stopLoss: 90,
    targetSizePct: 3,
    // No triggers and a far-future review date → nothing fires, no review
    // due → needsAction stays null → quiet row under "actionable".
    triggers: [],
    scalingPlan: null,
    catalystDate: null,
    maxHoldDays: null,
    nextReviewAt: new Date(Date.now() + 30 * 86_400_000),
    sourceSignalIds: [],
    sourceKind: "WEB_SEARCH",
    scoring: {},
    conviction: "MEDIUM",
    convictionRationale: "fine",
    variantView: null,
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-10"),
    invalidatedAt: null,
    invalidReason: null,
    closedAt: null,
    closeReason: null,
    parentThesisId: null,
    promotedAt: null,
    paperTenureDays: null,
    paperRealizedPnl: null,
    paperReviewCount: null,
    researchUpdatedAt: new Date("2026-08-10"),
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(ctx: ToolContext, args: Record<string, unknown> = {}): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = getTheses(ctx) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

beforeEach(() => {
  mockThesisFindMany.mockReset();
  mockThesisUpdateFindMany.mockResolvedValue([]);
  mockPositionFindMany.mockResolvedValue([]);
  mockOrderFindMany.mockResolvedValue([]);
  mockGetLatestPrices.mockReset();
  mockGetLatestPrices.mockResolvedValue({});
  mockGetBars.mockReset();
  mockGetBars.mockResolvedValue([]);
});

describe("get_theses detail split — MORNING_PLAN unfiltered read", () => {
  it("quiet rows collapse to index entries; PROMOTED stays full", async () => {
    mockThesisFindMany.mockResolvedValue([
      thesisRow({ id: "t_quiet", ticker: "QUIET" }),
      thesisRow({
        id: "t_promoted",
        ticker: "PROMO",
        status: "PROMOTED",
        promotedAt: new Date("2026-08-11"),
      }),
    ]);

    const res = await run(makeCtx("MORNING_PLAN"));

    // Full list: only the PROMOTED (must-resolve) row.
    expect(res.data.theses).toHaveLength(1);
    expect(res.data.theses[0].ticker).toBe("PROMO");
    // Full rows keep the narrative payload.
    expect(res.data.theses[0].snapshot).toBeDefined();

    // Quiet list: the index entry, WITHOUT narrative payload.
    expect(res.data.quiet_theses).toHaveLength(1);
    const quiet = res.data.quiet_theses[0];
    expect(quiet.ticker).toBe("QUIET");
    expect(quiet.coreBelief).toBe("Belief sentence.");
    expect(quiet.needsAction).toBeNull();
    expect(quiet.snapshot).toBeUndefined();
    expect(quiet.bullCase).toBeUndefined();
    expect(quiet.bearCase).toBeUndefined();
    expect(quiet.keyAssumptions).toBeUndefined();

    // Cards (UI carousel) only cover full rows — the quiet duplicate was
    // pure token tax on the model.
    expect(res.data.cards).toHaveLength(1);
    // Counts span the whole book.
    expect(res.data.count).toBe(2);
    expect(res.data.note).toContain("index rows");
  });

  it("an explicit ticker filter is a drill-down — always full detail", async () => {
    mockThesisFindMany.mockResolvedValue([thesisRow({ id: "t_quiet", ticker: "QUIET" })]);

    const res = await run(makeCtx("MORNING_PLAN"), { tickers: ["QUIET"] });

    expect(res.data.theses).toHaveLength(1);
    expect(res.data.theses[0].snapshot).toBeDefined();
    expect(res.data.quiet_theses).toHaveLength(0);
  });

  it("detail: \"book\" override returns everything full even on MORNING_PLAN", async () => {
    mockThesisFindMany.mockResolvedValue([thesisRow({ id: "t_quiet", ticker: "QUIET" })]);

    const res = await run(makeCtx("MORNING_PLAN"), { detail: "book" });

    expect(res.data.theses).toHaveLength(1);
    expect(res.data.quiet_theses).toHaveLength(0);
  });

  it("a ticker drill-down beats an explicit detail:\"actionable\" (review finding #4)", async () => {
    mockThesisFindMany.mockResolvedValue([thesisRow({ id: "t_quiet", ticker: "QUIET" })]);

    const res = await run(makeCtx("MORNING_PLAN"), {
      tickers: ["QUIET"],
      detail: "actionable",
    });

    expect(res.data.theses).toHaveLength(1);
    expect(res.data.theses[0].snapshot).toBeDefined();
    expect(res.data.quiet_theses).toHaveLength(0);
  });

  it("the writer's buy-at-market shape (ENTER_NOW, no needsAction) stays a FULL row (review finding #2)", async () => {
    // WATCHING, no ENTER trigger, live price ≈ entry → resolver says
    // ENTER_NOW while needsAction stays null. Hiding this row would strand
    // a writer-intended market entry indefinitely.
    mockGetLatestPrices.mockResolvedValue({ BUYNOW: 100 });
    mockThesisFindMany.mockResolvedValue([
      thesisRow({ id: "t_buynow", ticker: "BUYNOW", entryPrice: 100 }),
    ]);

    const res = await run(makeCtx("MORNING_PLAN"));

    expect(res.data.theses).toHaveLength(1);
    expect(res.data.theses[0].ticker).toBe("BUYNOW");
    expect(res.data.theses[0].resolved?.actionability).toBe("ENTER_NOW");
    expect(res.data.quiet_theses).toHaveLength(0);
  });

  it("a HELD_THROUGH_FLOOR row lands FULL in `theses`, not `quiet_theses` (P1-39)", async () => {
    // HOLDING with a protective floor at $90, price $85 (still breached),
    // and one genuine declined STOP proposal in the last 7 days → the
    // HELD_THROUGH_FLOOR needsAction fires, which makes the row full-detail.
    mockGetLatestPrices.mockResolvedValue({ HELD: 85 });
    mockPositionFindMany.mockResolvedValue([
      {
        id: "pos_held",
        symbol: "HELD",
        openedAt: new Date("2026-08-01"),
        avgCost: 100,
        peakPrice: 110,
      },
    ]);
    mockOrderFindMany.mockResolvedValue([
      {
        positionId: "pos_held",
        rejectionMessage: "hold, re-propose if it drops more",
        closeReason: "STOP",
        createdAt: new Date(Date.now() - 2 * 86_400_000),
      },
    ]);
    mockGetBars.mockResolvedValue([
      { close: 86, volume: 1000, low: 84.2, high: 88 },
      { close: 87, volume: 900, low: 85.1, high: 89 },
    ]);
    mockThesisFindMany.mockResolvedValue([
      thesisRow({
        id: "t_held",
        ticker: "HELD",
        status: "HOLDING",
        entryPrice: 100,
        stopLoss: 90,
        triggers: [
          {
            id: "trig-floor",
            action: "EXIT",
            predicate: { kind: "PRICE_BELOW", level: 90 },
            rationale: "protective floor",
            cooldownDays: 0,
          },
        ],
      }),
    ]);

    const res = await run(makeCtx("MORNING_PLAN"));

    expect(res.data.quiet_theses).toHaveLength(0);
    expect(res.data.theses).toHaveLength(1);
    const row = res.data.theses[0];
    expect(row.ticker).toBe("HELD");
    expect(row.snapshot).toBeDefined(); // full weight
    expect(row.needsAction).toEqual({
      kind: "HELD_THROUGH_FLOOR",
      floorPrice: 90,
      floorSummary: "price < $90.00",
      floorTriggerId: "trig-floor",
      heldThroughCount: 1,
      rejectMessage: "hold, re-propose if it drops more",
      recentLow: 84.2,
      livePrice: 85,
    });
  });

  it("a live-quote outage fails OPEN to the full book (review finding #3)", async () => {
    // When prices are down, the price-dependent needsAction kinds all
    // degrade to null — the split must not hide the winner book on
    // exactly the mornings data is flaky.
    mockGetLatestPrices.mockRejectedValue(new Error("quotes down"));
    mockThesisFindMany.mockResolvedValue([
      thesisRow({ id: "t_quiet", ticker: "QUIET" }),
    ]);

    const res = await run(makeCtx("MORNING_PLAN"));

    expect(res.data.theses).toHaveLength(1);
    expect(res.data.theses[0].snapshot).toBeDefined();
    expect(res.data.quiet_theses).toHaveLength(0);
  });
});

describe("get_theses detail split — every other caller unchanged", () => {
  it.each(["INTRADAY_TACTICAL", "DISCOVERY", undefined])(
    "runMode=%s returns the full book",
    async (mode) => {
      mockThesisFindMany.mockResolvedValue([
        thesisRow({ id: "t_quiet", ticker: "QUIET" }),
      ]);

      const res = await run(makeCtx(mode as string | undefined));

      expect(res.data.theses).toHaveLength(1);
      expect(res.data.theses[0].snapshot).toBeDefined();
      expect(res.data.quiet_theses).toHaveLength(0);
    },
  );
});
