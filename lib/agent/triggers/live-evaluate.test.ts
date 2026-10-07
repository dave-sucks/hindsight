/**
 * live-evaluate.test.ts — the 08:00 run's "matching now" list is matched
 * against the live price, not a pre-market print.
 *
 * The prices are DOCU's on 2026-10-06 at 08:00:30 ET, as Alpaca answered:
 * the latest trade was one 100-share print at 07:49 ET, $70.69; Monday had
 * closed $70.03. The review level at $70.50 is placed between the two for
 * the test — DOCU's own ladder had no level there.
 *
 * Only the database and the vendors are doubled; evaluateLiveTriggerMatches,
 * the ladder resolver, live-quote and the evaluator run for real.
 */
import { prismaDouble } from "@/lib/replay/prisma-double";
import { thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const AT = new Date("2026-10-06T12:00:30Z");
const PRINT = { p: 70.69, t: "2026-10-06T11:49:19.680Z" };
const MONDAY = { t: "2026-10-05T04:00:00Z", o: 69.02, h: 70.81, l: 68.91, c: 70.03, v: 1_000_000 };
const FRIDAY = { t: "2026-10-02T04:00:00Z", o: 69.84, h: 70.38, l: 68.28, c: 69.01, v: 1_000_000 };
const LEVEL = { id: "between", action: "REVIEW", predicate: { watch: "price", is: "above", value: 70.5 }, rationale: "Between the close and the print.", cooldownDays: 1 };

async function matchesAt(at: Date, snapshot: Record<string, unknown>) {
  const db = prismaDouble({
    thesis: [thesisRow({ id: "t_docu", ticker: "DOCU", status: "HOLDING", entryPrice: 67.7347, targetPrice: 83, stopLoss: 63, triggers: [LEVEL] })],
    position: [positionRow({ symbol: "DOCU", quantity: 120, avgCost: 67.7347, peakPrice: 70.145, openedAt: new Date("2026-09-30T16:25:14.191Z") })],
    agentConfig: [agentConfigRow({ id: REPLAY_ANALYST_ID })],
    account: [accountRow()],
  });
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    let out: Array<{ triggerId: string; matchDetail: string }> = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/alpaca", () => ({
        MARKET_DATA_FEED: "sip",
        getSnapshots: jest.fn(async () => ({ DOCU: snapshot })),
        // What the old path read: the latest trade, whenever it printed.
        getLatestPrices: jest.fn(async () => ({ DOCU: PRINT.p })),
      }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        ...jest.requireActual("@/lib/agent/research-helpers"),
        finnhub: jest.fn(async () => ({ data: null, error: "test: no vendor" })),
      }));
      jest.doMock("@/lib/market-data/load-indicators", () => ({ loadIndicatorSnapshots: jest.fn(async () => new Map()) }));
      const { evaluateLiveTriggerMatches } = await import("@/lib/agent/triggers/live-evaluate");
      out = await evaluateLiveTriggerMatches({ analystId: REPLAY_ANALYST_ID });
    });
    return out;
  } finally {
    jest.useRealTimers();
  }
}

describe("matching now — DOCU 2026-10-06", () => {
  it("at 08:00 reads Monday's $70.03 close, so a level at $70.50 is not matching", async () => {
    const matches = await matchesAt(AT, { latestTrade: PRINT, dailyBar: MONDAY, prevDailyBar: FRIDAY });
    expect(matches.find((m) => m.triggerId === "between")).toBeUndefined();
  });

  it("in the session a trade at $70.69 is the price, and the same level matches", async () => {
    const tenAm = new Date("2026-10-06T14:00:00Z");
    const matches = await matchesAt(tenAm, {
      latestTrade: { p: 70.69, t: "2026-10-06T13:59:58Z" },
      dailyBar: { t: "2026-10-06T04:00:00Z", o: 69.81, h: 70.69, l: 69.6, c: 70.69, v: 400_000 },
      prevDailyBar: MONDAY,
    });
    expect(matches.find((m) => m.triggerId === "between")?.matchDetail).toBe("current price $70.69");
  });
});
