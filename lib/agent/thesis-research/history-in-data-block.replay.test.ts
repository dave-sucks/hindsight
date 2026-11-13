/**
 * The Writer sees our history with the stock (2026-11-13). Its pull runs
 * get_stock_data with the analyst set, which reads our trades on the stock
 * and the last thesis (getTickerHistory) and writes them as `priorCoverage`;
 * the pull then dropped it. PRAX's two Writer runs on Nov 13 never saw our
 * trade (bought Jul 20, stopped out Aug 31 at a gain) or the thesis dropped
 * at LOW conviction in October, except as the chat retold them in its reason.
 *
 * PRAX's production rows: the Catalyst Event PM's closed position and its
 * October thesis. The prices, dates, exit and thesis are the real ones; the
 * share count and the dollars are the replay's, not the account's.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, REPLAY_ANALYST_ID, REPLAY_ACCOUNT_ID } from "@/lib/replay";
import type { ThesisPullResult } from "@/lib/agent/thesis-research/pull-data";

const seed = {
  agentConfig: [agentConfigRow({ name: "Catalyst Event PM" })],
  position: [
    positionRow({
      id: "cmrt6c7fm000d04l4d9an32up",
      symbol: "PRAX",
      status: "CLOSED",
      environment: "LIVE",
      quantity: 10,
      avgCost: 318.805,
      closePrice: 339.69,
      realizedPnl: 208.85,
      outcome: "WIN",
      closeReason: "STOP",
      openedAt: new Date("2026-07-20T13:38:02.607Z"),
      closedAt: new Date("2026-08-31T13:50:35.744Z"),
    }),
  ],
  thesis: [
    thesisRow({
      id: "cmrof7ayc000s04juomotwdmh",
      ticker: "PRAX",
      status: "RETIRED",
      retiredReason: "DROPPED",
      direction: "LONG",
      conviction: "LOW",
      catalystDate: new Date("2026-12-27T00:00:00Z"),
      researchUpdatedAt: new Date("2026-10-07T12:03:29.059Z"),
      createdAt: new Date("2026-07-17T04:10:56.436Z"),
      coreBelief:
        "Relutrigine (PDUFA Dec 27, 2026) and ulixacaltamide (PDUFA Jan 29, 2027) both receive FDA approval by Q1 2027, with the current tape dislocation — triggered by the September 27→December 27 PDUFA extension — creating a mis-priced entry window into a de-risked dual-binary regulatory path.",
    }),
  ],
};

/** get_stock_data as the Writer's pull calls it (buildWriterToolCtx: runMode THESIS_WRITER, the analyst set). */
const pullStockData = (runMode: string) =>
  replayTool("get-stock-data", "getStockData", {
    seed,
    ctx: { runMode, analystId: REPLAY_ANALYST_ID, accountId: REPLAY_ACCOUNT_ID, calledTickers: new Map() },
    args: { ticker: "PRAX", include_technicals: true },
    quotes: { PRAX: 324.76 },
  });

/** The Writer's pull with the six other data tools and three lookups answering nothing; get_stock_data's own reply. */
async function pullWith(stockReply: unknown): Promise<ThesisPullResult> {
  let pull!: ThesisPullResult;
  const none = { execute: async () => ({ ok: false, error: "replay: no vendor" }) };
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/agent/tools/get-stock-data", () => ({ getStockData: () => ({ execute: async () => stockReply }) }));
    jest.doMock("@/lib/agent/tools/get-financials-deep", () => ({ getFinancialsDeep: () => none }));
    jest.doMock("@/lib/agent/tools/get-analyst-coverage", () => ({ getAnalystCoverage: () => none }));
    jest.doMock("@/lib/agent/tools/get-insider-activity", () => ({ getInsiderActivity: () => none }));
    jest.doMock("@/lib/agent/tools/get-earnings-history", () => ({ getEarningsHistory: () => none }));
    jest.doMock("@/lib/agent/tools/get-peers-with-metrics", () => ({ getPeersWithMetrics: () => none }));
    jest.doMock("@/lib/agent/tools/get-sec-filings", () => ({ getSecFilings: () => none }));
    jest.doMock("@/lib/market-data/insider-cluster", () => ({ ...jest.requireActual("@/lib/market-data/insider-cluster"), fetchOpenMarketBuys: async () => null }));
    jest.doMock("@/lib/market-data/earnings-calendar", () => ({ fetchCalendarRows: async () => [] }));
    jest.doMock("@/lib/market-data/catalyst-calendar", () => ({ searchCatalystEvents: async () => ({ events: [], error: null }) }));
    const { pullThesisData } = await import("@/lib/agent/thesis-research/pull-data");
    pull = await pullThesisData("PRAX", {} as never);
  });
  return pull;
}

// Every replay here reads the same rows: getTickerHistory loads the database with a dynamic import, which
// jest's module isolation does not reset, so a second replay in this file would read the first one's rows.
describe("PRAX: our history with the stock reaches the Writer's data block", () => {
  it("get_stock_data, as the Writer's pull calls it, reads our trade and the October thesis", async () => {
    const { result, crashed } = await pullStockData("THESIS_WRITER");
    expect(crashed).toBe(false);
    const history = String(result.data?.priorCoverage);
    expect(history).toContain("bought 2026-07-20 @ $318.81, sold 2026-08-31 @ $339.69 (held 42d)");
    expect(history).toContain("(+6.6%), exit STOP");
    expect(history).toContain("LAST THESIS (cmrof7ayc000s04juomotwdmh): RETIRED (DROPPED) LONG, conviction LOW, researched 2026-10-07");
    expect(history).toContain('What we believed: "Relutrigine (PDUFA Dec 27, 2026)');
    // The Writer has no get_theses; every other agent is still pointed at it.
    expect(history).not.toContain("get_theses");
    expect(String((await pullStockData("PRINCIPAL_CHAT")).result.data?.priorCoverage)).toContain('get_theses(tickers: ["PRAX"], status: ["RETIRED"], include_history: true)');
  });

  it("the pull prints it first, under its own heading, before the price", async () => {
    const { result } = await pullStockData("THESIS_WRITER");
    const block = (await pullWith(result)).rawDataBlock;
    const section = `## Our history with $PRAX\n\n${String(result.data?.priorCoverage)}`;
    expect(block).toContain(section);
    expect(block.indexOf(section)).toBeLessThan(block.indexOf("## Snapshot"));
  });

  it("a stock with no history (get_stock_data sends none) gets no section, never a claim of no history", async () => {
    expect((await pullWith({ ok: true, summary: "", data: {} })).rawDataBlock).not.toContain("## Our history");
  });
});
