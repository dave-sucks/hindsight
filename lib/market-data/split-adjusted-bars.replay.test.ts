/**
 * split-adjusted-bars.replay.test.ts — DAV-333, from NOW's real bars.
 *
 * Found 2026-09-27 on the watchlist: NOW's indicator snapshot carried
 * `high52w: 973.63` against a $135 price — ServiceNow's pre-split high (5-for-1
 * on 2025-12-18). The 52-week high and low, the 150- and 200-day averages,
 * the trend check and six-month relative strength were all built from raw
 * bars, so the chart read as broken (trend check 3 of 7, "−86% from the
 * 52-week high"), writers declined to price it, and the trigger kinds that
 * read those numbers read false. CRWD (4-for-1, 2026-07-02) is the same:
 * its snapshot says $786 against ~$200.
 *
 * Cause: the shared bar pulls asked Alpaca for bars with no adjustment, and
 * Alpaca's default is raw.
 *
 * Replayed through the real path — `computeAndStoreSnapshot("NOW")` →
 * `getDailyBars` → the vendor SDK — with the SDK doubled to behave as Alpaca
 * does: raw bars unless the request says `adjustment: "split"`. The bars are
 * NOW's 260 sessions ending 2026-09-24, pulled both ways on 2026-09-29.
 *
 * On main this fails: the request carries no adjustment, the raw bars come
 * back, and the stored high is $973.63.
 */
import fixture from "./__fixtures__/alpaca-now-daily-bars-2026-09-24.json";

type Tuple = [string, number, number, number, number, number];
const toBars = (rows: unknown[]) =>
  (rows as Tuple[]).map(([date, o, h, l, c, v]) => ({ t: `${date}T04:00:00Z`, o, h, l, c, v }));

/** Every bar request the doubled vendor received, as the SDK was asked. */
const asked: { symbol: string; options: Record<string, unknown> }[] = [];

jest.mock("@alpacahq/alpaca-trade-api", () => ({
  __esModule: true,
  default: class AlpacaDouble {
    constructor(_config: unknown) {
      void _config;
    }
    async *getBarsV2(symbol: string, options: Record<string, unknown>) {
      asked.push({ symbol, options });
      // Alpaca's behaviour: raw unless asked for split-adjusted bars.
      const rows = options.adjustment === "split" ? fixture.splitAdjusted : fixture.raw;
      for (const bar of toBars(rows)) yield bar;
    }
  },
}));

const upsert = jest.fn().mockResolvedValue({});
jest.mock("@/lib/prisma", () => ({ prisma: { tickerIndicators: { upsert: (...a: unknown[]) => upsert(...a) } } }));
jest.mock("@/lib/market-data/insider-cluster", () => ({ fetchOpenMarketBuys: jest.fn().mockResolvedValue(null) }));

import { computeAndStoreSnapshot } from "./ensure-snapshots";
import { getBars } from "@/lib/alpaca";

const AFTER_THE_BELL = new Date("2026-09-24T20:30:00Z"); // 16:30 ET — today's bar is finished

beforeEach(() => {
  asked.length = 0;
  upsert.mockClear();
  // The clock is 16:30 ET on the snapshot's date. Timers are faked too, so the
  // bar pull's own 10-second timeout never holds the run open.
  jest.useFakeTimers({ now: AFTER_THE_BELL, doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] });
  process.env.ALPACA_API_KEY = "PKTEST";
  process.env.ALPACA_API_SECRET = "secret";
});
afterEach(() => jest.useRealTimers());

const stored = () => (upsert.mock.calls[0][0] as { create: { snapshot: Record<string, unknown> } }).create.snapshot;

describe("NOW's snapshot, 2026-09-24 — a stock that split 5-for-1 inside the year", () => {
  it("asks Alpaca for split-adjusted bars", async () => {
    await computeAndStoreSnapshot("NOW");
    expect(asked[0]).toMatchObject({ symbol: "NOW", options: { timeframe: "1Day", adjustment: "split" } });
  });

  it("the 52-week high is $194.73, not the pre-split $973.63", async () => {
    const snapshot = await computeAndStoreSnapshot("NOW");
    expect(snapshot?.high52w).toBe(194.73);
    expect(snapshot?.low52w).toBe(81.24);
    expect(stored().high52w).toBe(194.73);
  });

  it("the chart reads as one series: the price sits 29% below the high, not 86%, and the long averages are on scale", async () => {
    const snapshot = await computeAndStoreSnapshot("NOW");
    const price = 137.78; // the 09-24 close
    expect(Math.round(((snapshot!.high52w - price) / snapshot!.high52w) * 100)).toBe(29);
    // Raw bars put the 200-day average in the hundreds; adjusted, it is a price the stock could trade near.
    expect(snapshot!.sma[200]).toBeGreaterThan(100);
    expect(snapshot!.sma[200]).toBeLessThan(200);
    expect(snapshot!.sma[150]).toBeLessThan(200);
  });

  it("the same bars raw — what main asked for — give the numbers the watchlist showed", async () => {
    const { computePriceStructure } = await import("./price-structure");
    const raw = computePriceStructure({
      bars: (fixture.raw as Tuple[]).map(([date, open, high, low, close, volume]) => ({ date, open, high, low, close, volume })),
    });
    expect(raw?.range.high52w).toBe(973.63);
    expect(raw?.range.pctBelow52wHigh).toBe(85.8);
  });
});

describe("every shared bar pull asks the same way", () => {
  it("getBars (SPY trend, peers, held-through context) carries the adjustment too", async () => {
    await getBars("SPY", { start: "2026-08-25", end: "2026-09-24" });
    expect(asked.at(-1)).toMatchObject({ symbol: "SPY", options: { adjustment: "split" } });
  });
});
