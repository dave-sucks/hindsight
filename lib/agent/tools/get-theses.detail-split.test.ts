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
    // The trigger cascade (lib/agent/triggers/load-levels) resolves the
    // ANALYST + ACCOUNT levels for every row. Empty ⇒ these theses
    // resolve to their own rungs, which is what the split tests care about.
    agentConfig: { findMany: jest.fn().mockResolvedValue([]) },
    account: { findMany: jest.fn().mockResolvedValue([]) },
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

/**
 * Fixture dates are RELATIVE, and must stay that way.
 *
 * These rows are meant to read as "quiet": nothing fired, nothing due, so
 * `needsAction` stays null and the row collapses to an index entry. Several
 * of the thresholds that decide that are measured against the real clock, so
 * a hardcoded date is a time bomb — it passes until the wall clock drifts
 * past the threshold, then fails for a reason that has nothing to do with
 * the code under test.
 *
 * That is exactly what happened: `researchUpdatedAt` was pinned to
 * 2026-08-10, the TARGET horizon calls research stale after 30 days, and on
 * 2026-09-09 the quiet row started reporting RESEARCH_STALE and stopped
 * being quiet.
 *
 * If you add a threshold-sensitive field here, express it in days-ago.
 */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Comfortably inside every staleness threshold, including CATALYST's 7 days. */
const FRESH_RESEARCH = () => daysAgo(3);

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
    // A setup is named: a priced row with none is work now (DAV-292).
    setupId: "BASE_BREAKOUT",
    // No triggers → no cadence rung → nothing fires, no review due →
    // needsAction stays null → quiet row under "actionable".
    triggers: [],
    catalystDate: null,
    maxHoldDays: null,
    lastReviewedAt: null,
    sourceSignalIds: [],
    sourceKind: "WEB_SEARCH",
    scoring: {},
    conviction: "MEDIUM",
    convictionRationale: "fine",
    variantView: null,
    createdAt: daysAgo(40),
    updatedAt: FRESH_RESEARCH(),
    invalidatedAt: null,
    invalidReason: null,
    closedAt: null,
    closeReason: null,
    parentThesisId: null,
    promotedAt: null,
    paperTenureDays: null,
    paperRealizedPnl: null,
    paperReviewCount: null,
    researchUpdatedAt: FRESH_RESEARCH(),
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
        promotedAt: daysAgo(3),
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

  it("still holds a year from now — the fixture is not a time bomb", async () => {
    // The guard for the bug this file already had once. Every fixture date is
    // relative, so moving the wall clock forward moves the rows with it and
    // the quiet row stays quiet. Re-hardcode a date and this fails the moment
    // it crosses a threshold, here rather than on some random morning.
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    try {
      jest.setSystemTime(new Date(Date.now() + 365 * 86_400_000));
      mockThesisFindMany.mockResolvedValue([
        thesisRow({ id: "t_quiet", ticker: "QUIET" }),
      ]);
      const res = await run(makeCtx("MORNING_PLAN"));
      expect(res.data.theses).toHaveLength(0);
      expect(res.data.quiet_theses).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
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

  it("a buy level on the live price is not flagged for being there — a 40-day-old one is flagged stale", async () => {
    // Until 2026-09-14 this row was flagged ENTRY_AT_PRICE. A buy at or near
    // the price is how buying now is written (no buy-now option), so that
    // flag is gone. The fixture's plan is 40 days old, so the stale-entry
    // flag is what arrives — proving watches now get their last edit date.
    mockGetLatestPrices.mockResolvedValue({ BUYNOW: 100 });
    mockThesisFindMany.mockResolvedValue([
      thesisRow({ id: "t_buynow", ticker: "BUYNOW", entryPrice: 100 }),
    ]);

    const res = await run(makeCtx("MORNING_PLAN"));

    expect(res.data.theses).toHaveLength(1);
    expect(res.data.theses[0].ticker).toBe("BUYNOW");
    expect(res.data.theses[0].resolved?.actionability).toBe("WAIT_FOR_TRIGGER");
    expect(res.data.theses[0].resolved?.planSanity?.map((f: { kind: string }) => f.kind)).toEqual(["ENTRY_STALE"]);
    expect(res.data.quiet_theses).toHaveLength(0);
  });

  it("held-through-floor CONTEXT rides on the full row; it never becomes a needsAction (P1-39 ruling)", async () => {
    // HOLDING with a protective floor at $90, price $85 (still breached), and
    // one genuine declined STOP proposal in the last 7 days. The row is full
    // because the floor rung is MATCHING (the standing order fires every day
    // its condition is true) — the held-through data rides along as context
    // for the proposal rationale, and never authorizes a level edit.
    mockGetLatestPrices.mockResolvedValue({ HELD: 85 });
    mockPositionFindMany.mockResolvedValue([
      {
        id: "pos_held",
        symbol: "HELD",
        openedAt: daysAgo(40),
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

    // The standing order still fires — the breach surfaces through the normal
    // trigger path, every day, exactly as before this PR. Nothing suppressed.
    expect(row.needsAction?.kind).toBe("TRIGGER_MATCHING_NOW");
    expect(row.needsAction?.action).toBe("EXIT");

    // The context rides alongside so the proposal can say "1st day under your
    // $90 floor, recent low $84.20" — informational only.
    expect(row.heldThroughFloor).toEqual({
      floorPrice: 90,
      heldThroughCount: 1,
      rejectMessage: "hold, re-propose if it drops more",
      recentLow: 84.2,
    });
  });

  it("held-through context is dropped once price recovers above the floor (review finding #1)", async () => {
    // Same declined-STOP history, but price is back ABOVE the $90 floor. The
    // line held — asserting "Nth day under your floor" would be false, so the
    // context must not ride along.
    mockGetLatestPrices.mockResolvedValue({ HELD: 96 });
    mockPositionFindMany.mockResolvedValue([
      {
        id: "pos_held",
        symbol: "HELD",
        openedAt: daysAgo(40),
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
    mockThesisFindMany.mockResolvedValue([
      thesisRow({
        id: "t_held",
        ticker: "HELD",
        status: "HOLDING",
        entryPrice: 100,
        stopLoss: 90,
        // An overdue review is what keeps this row FULL. Since DAV-195 L7
        // that means "last looked at longer ago than the cadence", not a
        // date column.
        lastReviewedAt: new Date(Date.now() - 30 * 86_400_000),
        triggers: [
          {
            id: "trig-floor",
            action: "EXIT",
            predicate: { kind: "PRICE_BELOW", level: 90 },
            rationale: "protective floor",
            cooldownDays: 0,
          },
          {
            id: "trig-cadence",
            action: "REVIEW",
            predicate: { kind: "REVIEW_CADENCE", days: 7 },
            rationale: "weekly look",
            cooldownDays: 7,
          },
        ],
      }),
    ]);

    const res = await run(makeCtx("MORNING_PLAN"));

    expect(res.data.theses).toHaveLength(1);
    expect(res.data.theses[0].heldThroughFloor).toBeNull();
    // unapprovedExitCount is all-time and price-independent — still counted.
    expect(res.data.theses[0].unapprovedExitCount).toBe(1);
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

// ── DAV-292 / DAV-286 — two inputs the run wasn't getting ──────────────────
describe("get_theses — a stock with no setup named, and a buy that fired into a full analyst", () => {
  it("PEAD 2026-09-18: MU, IOT and NVDA (held, no setup) arrive as full rows with the ask; FIVE (setup named) stays quiet", async () => {
    // That morning the PEAD run saw its held names as index rows and wrote
    // "the held names are all quiet, so I'm not going to manufacture work
    // there." The ask only rode on full rows, so nobody was asked.
    const held = (ticker: string, setupId: string | null) =>
      thesisRow({ id: `t_${ticker}`, ticker, status: "HOLDING", setupId, researchRun: { agentConfig: { setupIds: ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"] } } });
    mockThesisFindMany.mockResolvedValue([held("MU", null), held("IOT", null), held("NVDA", null), held("FIVE", "PEAD")]);
    const res = await run(makeCtx("MORNING_PLAN"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const full = res.data.theses as any[];
    expect(full.map((t) => t.ticker).sort()).toEqual(["IOT", "MU", "NVDA"]);
    for (const t of full) {
      expect(t.nameTheSetup?.choose.map((c: { id: string }) => c.id)).toEqual(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res.data.quiet_theses as any[]).map((t) => t.ticker)).toEqual(["FIVE"]);
  });

  it("Secular Compounder 2026-09-18: ETN's buy fired into 4 of 4 — the row carries the portfolio decision", async () => {
    const ctx = { ...makeCtx("MORNING_PLAN"), maxOpenPositions: 4 } as ToolContext;
    const holds = ["ABT", "ASML", "CEG", "WST"].map((ticker) =>
      thesisRow({ id: `t_${ticker}`, ticker, status: "HOLDING", setupId: "COMPOUNDER_ACCUMULATION" }),
    );
    const fired = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const etn = thesisRow({
      id: "t_ETN",
      ticker: "ETN",
      entryPrice: 418,
      targetPrice: 480,
      stopLoss: 395,
      setupId: "COMPOUNDER_ACCUMULATION",
      triggers: [{ id: "enter", action: "ENTER", predicate: { kind: "PRICE_ABOVE", level: 418 }, rationale: "Buy above $418.", lastFiredAt: fired, cooldownDays: 7 }],
    });
    const eme = thesisRow({ id: "t_EME", ticker: "EME", setupId: "COMPOUNDER_ACCUMULATION" });
    mockThesisFindMany.mockResolvedValue([...holds, etn, eme]);
    const res = await run(ctx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (res.data.theses as any[]).find((t) => t.ticker === "ETN");
    expect(row).toBeDefined();
    expect(row.buyBlockedByFull).toMatch(/this analyst is full \(4 of 4: \$ABT, \$ASML, \$CEG, \$WST\)/);
    expect(row.buyBlockedByFull).toMatch(/which held stock \$ETN would replace/);
    // A watched stock whose buy never fired is not the question.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res.data.quiet_theses as any[]).map((t) => t.ticker)).toContain("EME");
  });
});

