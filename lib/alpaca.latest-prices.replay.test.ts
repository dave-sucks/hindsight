/**
 * alpaca.latest-prices.replay.test.ts — the pages' price is the session's,
 * from Alpaca's own replies.
 *
 * The four snapshots are what Alpaca returned on Saturday 2026-10-31 at about
 * 10:00 ET (feed=sip), the morning after FINRA's extended-hours industry test
 * put fake prints on the live tape from 11:00 PM Friday: MSFT's latest
 * "trade" is $445.05 at 00:59 ET Saturday against a $521.91 close, MU's
 * $907.21 against $884.74. V and IOT last printed in Friday's after-hours.
 * The homepage, reading the raw latest trade, showed MSFT down 14.73% on the
 * day and 17 of 31 names on the book 1% or more off; the sheet header,
 * reading the quote path, showed the close. On main these fail: the helpers
 * ask `/trades/latest` and hand back the print.
 */
import type { AlpacaSnapshot } from "./alpaca";
import { getDailyRangePcts, getLatestPrice, getLatestPrices, getLatestPricesWithMeta } from "./alpaca";
import { resetQuoteBudget } from "@/lib/market-data/quote-budget";

const SATURDAY = new Date("2026-10-31T14:00:00Z"); // Sat 10:00 ET

const AFTER_THE_TEST: Record<string, AlpacaSnapshot> = {
  MSFT: {
    latestTrade: { p: 445.05, t: "2026-10-31T04:59:19.667372328Z" },
    dailyBar: { t: "2026-10-30T04:00:00Z", o: 525.27, h: 526, l: 514.35, c: 521.91, v: 38_462_029 },
    prevDailyBar: { t: "2026-10-29T04:00:00Z", o: 540.22, h: 541.29, l: 519.56, c: 530.14, v: 39_420_309 },
  },
  MU: {
    latestTrade: { p: 907.21, t: "2026-10-31T04:59:56.442563801Z" },
    dailyBar: { t: "2026-10-30T04:00:00Z", o: 883.995, h: 906.54, l: 861.585, c: 884.74, v: 31_116_007 },
    prevDailyBar: { t: "2026-10-29T04:00:00Z", o: 967.935, h: 971.01, l: 927.24, c: 934.27, v: 22_447_993 },
  },
  V: {
    latestTrade: { p: 414.05, t: "2026-10-30T23:57:12.533731545Z" },
    dailyBar: { t: "2026-10-30T04:00:00Z", h: 417, l: 411.82, c: 413.59 },
    prevDailyBar: { t: "2026-10-29T04:00:00Z", c: 410.54 },
  },
  IOT: {
    latestTrade: { p: 42, t: "2026-10-30T23:50:31.349553401Z" },
    dailyBar: { t: "2026-10-30T04:00:00Z", h: 42.3, l: 40.7, c: 42.07 },
    prevDailyBar: { t: "2026-10-29T04:00:00Z", c: 41.65 },
  },
};

// SMMT as the DAV-264 probe saw it on Tuesday 2026-09-29 at 14:31:45 ET, the
// market open (lib/market-data/live-quote.test.ts).
const MID_SESSION = new Date("2026-09-29T18:31:45.900Z");
const SMMT: Record<string, AlpacaSnapshot> = {
  SMMT: {
    latestTrade: { p: 16.425, t: "2026-09-29T18:31:45Z" },
    dailyBar: { t: "2026-09-29T04:00:00Z", o: 18.91, h: 19.09, l: 16.15, c: 16.445, v: 22_318_315 },
    prevDailyBar: { t: "2026-09-28T04:00:00Z", o: 15.5, h: 15.82, l: 15.18, c: 15.48, v: 6_124_956 },
  },
};

let asked: string[] = [];

/** Alpaca answers snapshots from the given replies; Finnhub has no price for anything. */
function vendor(snapshots: Record<string, AlpacaSnapshot>) {
  asked = [];
  const reply = (body: unknown) =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ "x-ratelimit-limit": "10000", "x-ratelimit-remaining": "9999", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 40) }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    asked.push(u);
    if (!u.includes("data.alpaca.markets")) return reply({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
    const symbols = (new URL(u).searchParams.get("symbols") ?? "").split(",");
    return reply(Object.fromEntries(symbols.filter((s) => snapshots[s]).map((s) => [s, snapshots[s]])));
  }) as unknown as typeof fetch;
}

const OLD_ENV = process.env;
beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.useFakeTimers({
    now: SATURDAY,
    doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance", "hrtime"],
  });
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret", FINNHUB_API_KEY: "fh" };
  resetQuoteBudget();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.env = OLD_ENV;
});

describe("Saturday 2026-10-31, the morning after FINRA's test prints", () => {
  it("every name is Friday's close, stamped at Friday's bell — MSFT $521.91, never the $445.05 print", async () => {
    vendor(AFTER_THE_TEST);
    const out = await getLatestPricesWithMeta(["MSFT", "MU", "V", "IOT"]);
    expect(out.prices).toEqual({ MSFT: 521.91, MU: 884.74, V: 413.59, IOT: 42.07 });
    expect(out.sources).toEqual({ MSFT: "alpaca", MU: "alpaca", V: "alpaca", IOT: "alpaca" });
    expect(new Set(Object.values(out.asOf))).toEqual(new Set(["2026-10-30T20:00:00.000Z"]));
  });

  it("one snapshot call for the book, feed named; the raw latest-trade endpoint is never asked", async () => {
    vendor(AFTER_THE_TEST);
    await getLatestPrices(["MSFT", "MU", "V", "IOT"]);
    expect(asked).toEqual(["https://data.alpaca.markets/v2/stocks/snapshots?symbols=MSFT%2CMU%2CV%2CIOT&feed=sip"]);
    expect(asked.some((u) => u.includes("trades/latest"))).toBe(false);
  });

  it("one symbol reads the same number", async () => {
    vendor(AFTER_THE_TEST);
    expect(await getLatestPrice("MSFT")).toBe(521.91);
  });

  it("the plan-sanity range check measures the day's range off the close, not the print", async () => {
    vendor(AFTER_THE_TEST);
    // Thursday's range, 541.29 − 519.56, is the wider; off $521.91 it is 4.16%
    // (off the $445.05 print it read 4.88%).
    expect((await getDailyRangePcts(["MSFT"])).MSFT).toBeCloseTo(((541.29 - 519.56) / 521.91) * 100, 6);
  });

  it("a symbol no vendor prices is marked missing, the rest are priced, and nothing throws", async () => {
    vendor(AFTER_THE_TEST);
    const out = await getLatestPricesWithMeta(["MSFT", "ZZZZ"]);
    expect(out.prices).toEqual({ MSFT: 521.91 });
    expect(out.sources).toEqual({ MSFT: "alpaca", ZZZZ: "missing" });
    await expect(getLatestPrice("ZZZZ")).rejects.toThrow("No price available for ZZZZ");
  });
});

describe("the market open: the price keeps ticking", () => {
  it("SMMT at 14:31:45 ET is the latest trade, with that trade's own time", async () => {
    jest.setSystemTime(MID_SESSION);
    vendor(SMMT);
    const out = await getLatestPricesWithMeta(["SMMT"]);
    expect(out.prices).toEqual({ SMMT: 16.425 });
    expect(out.asOf).toEqual({ SMMT: "2026-09-29T18:31:45.000Z" });
  });
});
