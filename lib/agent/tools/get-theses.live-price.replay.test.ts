/**
 * get-theses.live-price.replay.test.ts — the price a morning read shows is
 * the live price, from the one place it comes from (lib/market-data/live-quote).
 *
 * Production, 2026-10-06 08:00 ET: the PEAD Specialist's morning read showed
 * DOCU at $70.69. That was one 100-share trade at 07:49 ET, before the
 * open, and above the stock's tracked high of $70.145. DOCU had closed
 * $70.03 the day before, opened $69.81 and closed the session at $68.22.
 * get_theses read the tape's latest trade, pre-market prints included;
 * live-quote serves the last close outside the session.
 *
 * The vendor below answers exactly as Alpaca did for that minute: the
 * latest trade is the 07:49 print, the daily bars are Friday's and
 * Monday's. Only the vendor and the database are doubled.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const AT = new Date("2026-10-06T12:00:30Z"); // 08:00:30 ET, Tuesday
const PRINT = { p: 70.69, t: "2026-10-06T11:49:19.680Z" };
const MONDAY = { t: "2026-10-05T04:00:00Z", o: 69.02, h: 70.81, l: 68.91, c: 70.03, v: 1_000_000 };
const FRIDAY = { t: "2026-10-02T04:00:00Z", o: 69.84, h: 70.38, l: 68.28, c: 69.01, v: 1_000_000 };

/** Alpaca at 08:00:30 ET: before the open, `dailyBar` is still Monday's. */
function alpacaThatMorning() {
  const empty = async () => ({});
  return {
    MARKET_DATA_FEED: "sip",
    getSnapshots: jest.fn(async (syms: string[]) =>
      Object.fromEntries(syms.filter((s) => s === "DOCU").map((s) => [s, { latestTrade: PRINT, dailyBar: MONDAY, prevDailyBar: FRIDAY }])),
    ),
    // What the old path read: the latest trade on the tape, whenever it printed.
    getLatestPricesWithMeta: jest.fn(async (syms: string[]) => ({
      prices: syms.includes("DOCU") ? { DOCU: PRINT.p } : {},
      sources: syms.includes("DOCU") ? { DOCU: "alpaca" } : {},
      asOf: syms.includes("DOCU") ? { DOCU: PRINT.t } : {},
      fetchedAt: AT.toISOString(),
    })),
    getLatestPrices: jest.fn(async (syms: string[]) => (syms.includes("DOCU") ? { DOCU: PRINT.p } : {})),
    getLatestPrice: jest.fn(async () => PRINT.p),
    getAccount: jest.fn(async () => ({ equity: "115869.26", cash: "40000", buying_power: "80000", portfolio_value: "115869.26" })),
    getBars: jest.fn(async () => []),
    getDailyBars: jest.fn(async () => []),
    getDailyRangePcts: jest.fn(empty),
    getTodaySessionBars: jest.fn(empty),
    getPositions: jest.fn(async () => []),
    getAllPositions: jest.fn(async () => []),
    getPosition: jest.fn(async () => null),
    getOpenOrders: jest.fn(async () => []),
    getOrder: jest.fn(async () => null),
    getOrderByClientOrderId: jest.fn(async () => null),
  };
}

const fakeClock = (at: Date) =>
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });

async function readDocu() {
  fakeClock(AT);
  try {
    return await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [
          thesisRow({
            id: "cmtu9lfhw000004i575f6xyig",
            ticker: "DOCU",
            status: "HOLDING",
            horizon: "TARGET",
            setupId: "MA_PULLBACK",
            entryPrice: 67.7347,
            targetPrice: 83,
            stopLoss: 63,
            triggers: [
              { id: "floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 63 }, rationale: "Floor.", cooldownDays: 1 },
              { id: "target", action: "REVIEW", predicate: { watch: "price", is: "above", value: 83 }, rationale: "Target.", cooldownDays: 1 },
            ],
          }),
        ],
        position: [
          positionRow({ id: "cmuo5kmve000404ladc9io1da", symbol: "DOCU", quantity: 120, initialQty: 120, avgCost: 67.7347, peakPrice: 70.145, openedAt: new Date("2026-09-30T16:25:14.191Z") }),
        ],
        agentConfig: [agentConfigRow({ id: REPLAY_ANALYST_ID, name: "PEAD Specialist", maxOpenPositions: 6 })],
        account: [accountRow()],
      },
      args: { tickers: ["DOCU"] },
      ctx: { runMode: "MORNING_PLAN", maxOpenPositions: 6 },
      mocks: { "@/lib/alpaca": alpacaThatMorning },
    });
  } finally {
    jest.useRealTimers();
  }
}

describe("the morning read's price is the live price — DOCU 2026-10-06 08:00 ET", () => {
  it("is Monday's $70.03 close, stamped at its bell — not the 07:49 pre-market print", async () => {
    const { result, crashed } = await readDocu();
    expect(crashed).toBe(false);
    const row = (result.data?.theses as Array<{ ticker: string; resolved: { currentPrice: number | null; priceAsOf?: string | null } }>).find((t) => t.ticker === "DOCU")!;
    expect(row.resolved.currentPrice).toBe(70.03);
    expect(row.resolved.currentPrice).not.toBe(70.69);
  });

  it("says nothing is stale: outside the session the last close is the price", async () => {
    const { result } = await readDocu();
    expect(result.summary ?? "").not.toMatch(/not current/);
  });
});
