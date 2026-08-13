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
  getLatestPrices: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock("@/lib/proposals/pending-entry", () => ({
  getPendingEntryTickers: jest.fn().mockResolvedValue(new Set()),
}));

import { getTheses } from "./get-theses";
import type { ToolContext } from "@/lib/agent/tool-context";

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
