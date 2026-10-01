/**
 * chat-lookups-2026-09-14.replay.test.ts — DAV-264, from the saved chat.
 *
 * Run cmu1cx9o7000004l588chx8cz, 2026-09-14 10:47:33 ET: Dave's chat "review
 * my pending sells" called get_stock_data for NVDA, CEG, ASML and MU. All
 * four came back `quote: null` with "Finnhub /quote rate limited (429) after
 * 2 retries" — the shared key was spent — and each chart was measured from
 * Friday's close. NVDA read 2.68% above its 50-day ($218.29 vs $212.58) while
 * it was trading at $210.54, below it.
 *
 * Replayed through get_stock_data's real execute. Finnhub answers the quote
 * exactly as it did (429). Alpaca answers with what its tape held at that
 * second (pulled 2026-09-29, feed=sip), and the daily bars are the 260
 * sessions each chart was built from. Only the vendors are doubled —
 * lib/market-data/live-quote and quote-age run for real.
 *
 * On main this fails: the tool never asks Alpaca for a price, so all four
 * come back with no quote and the warning.
 */
import { replayTool } from "@/lib/replay";
import dailyBars from "./__fixtures__/chat-2026-09-14-daily-bars.json";

const CHAT_AT = new Date("2026-09-14T14:47:34Z");
const FINNHUB_429 = "Finnhub /quote rate limited (429) after 2 retries";

/** Alpaca's tape at 10:47:33 ET: the latest trade, the session so far, Friday's bar. */
const TAPE = {
  NVDA: {
    latestTrade: { p: 210.5399, t: "2026-09-14T14:47:33.990742093Z" },
    dailyBar: { t: "2026-09-14T04:00:00Z", o: 211.24, h: 211.7, l: 208.93, c: 210.66, v: 40_633_885 },
    prevDailyBar: { t: "2026-09-11T04:00:00Z", o: 221.235, h: 222, l: 218.15, c: 218.29, v: 90_036_579 },
  },
  CEG: {
    latestTrade: { p: 264.96, t: "2026-09-14T14:47:33.893377909Z" },
    dailyBar: { t: "2026-09-14T04:00:00Z", o: 276.515, h: 276.515, l: 264.77, c: 265.141, v: 1_058_187 },
    prevDailyBar: { t: "2026-09-11T04:00:00Z", o: 290.58, h: 291.3, l: 284.08, c: 284.75, v: 1_720_953 },
  },
  ASML: {
    latestTrade: { p: 1600.1593, t: "2026-09-14T14:47:33.984084944Z" },
    dailyBar: { t: "2026-09-14T04:00:00Z", o: 1594.21, h: 1610.41, l: 1579.03, c: 1600.565, v: 492_282 },
    prevDailyBar: { t: "2026-09-11T04:00:00Z", o: 1726.87, h: 1727.3099, l: 1696.21, c: 1698.3, v: 898_037 },
  },
  MU: {
    latestTrade: { p: 914.909, t: "2026-09-14T14:47:33.983678198Z" },
    dailyBar: { t: "2026-09-14T04:00:00Z", o: 906.03, h: 921.74, l: 902.6, c: 915.535, v: 10_690_715 },
    prevDailyBar: { t: "2026-09-11T04:00:00Z", o: 993.195, h: 993.99, l: 967.38, c: 975.26, v: 21_786_071 },
  },
} as const;

type Ticker = keyof typeof TAPE;

/** What the saved results carried for each name. */
const SAVED: Record<Ticker, { name: string; industry: string; fridayClose: number; volumeSoFar: number }> = {
  NVDA: { name: "NVIDIA Corp", industry: "Semiconductors", fridayClose: 218.29, volumeSoFar: 52_588_160 },
  CEG: { name: "Constellation Energy Corp", industry: "Utilities", fridayClose: 284.75, volumeSoFar: 1_078_650 },
  ASML: { name: "ASML Holding NV", industry: "Semiconductors", fridayClose: 1698.3, volumeSoFar: 584_204 },
  MU: { name: "Micron Technology Inc", industry: "Semiconductors", fridayClose: 975.26, volumeSoFar: 12_466_920 },
};

const barsFor = (ticker: Ticker) =>
  (dailyBars as Record<string, (string | number)[][]>)[ticker].map(([date, open, high, low, close, volume]) => ({
    date: String(date),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  }));

const lookup = (ticker: Ticker, alpaca: "up" | "down" = "up") =>
  replayTool("get-stock-data", "getStockData", {
    args: { ticker },
    // The chat carried no analyst — it was the principal's.
    ctx: { analystId: undefined, runMode: "PRINCIPAL_CHAT" },
    mocks: {
      "@/lib/agent/research-helpers": () => ({
        finnhub: jest.fn(async (path: string) => {
          if (path.startsWith("/quote")) return { data: null, error: FINNHUB_429 };
          if (path.startsWith("/stock/profile2")) {
            return { data: { name: SAVED[ticker].name, finnhubIndustry: SAVED[ticker].industry, exchange: "NASDAQ", country: "US" } };
          }
          return { data: null };
        }),
      }),
      "@/lib/alpaca": () => ({
        MARKET_DATA_FEED: "sip",
        getSnapshots: jest.fn(async (symbols: string[]) => {
          if (alpaca === "down") throw new Error("Alpaca getSnapshots(1 symbols) 503");
          return Object.fromEntries(symbols.filter((s) => s in TAPE).map((s) => [s, TAPE[s as Ticker]]));
        }),
        getDailyBars: jest.fn(async (symbol: string) => ({ feed: "sip", bars: barsFor(symbol as Ticker) })),
        getTodaySessionBars: jest.fn(async () => ({ [ticker]: { volume: SAVED[ticker].volumeSoFar } })),
      }),
      "@/lib/market-data/benchmark-bars": () => ({
        CHART_SESSIONS: 260,
        getBenchmarkBars: jest.fn(async () => undefined),
      }),
    },
  });

beforeEach(() => {
  // Only the clock is moved — to the second the chat asked.
  jest.useFakeTimers({
    now: CHAT_AT,
    doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance", "hrtime"],
  });
});
afterEach(() => {
  jest.useRealTimers();
});

describe("the 2026-09-14 10:47 chat — four lookups while Finnhub's key was spent", () => {
  it.each(Object.keys(TAPE) as Ticker[])("%s comes back with a live price and its age", async (ticker) => {
    const { result, crashed } = await lookup(ticker);
    expect(crashed).toBe(false);
    const data = result.data as {
      quote: { price: number; prevClose: number; open: number; asOf: string; ageMinutes: number; live: boolean } | null;
      priceWarning?: string;
      apiErrors?: string[];
      technicals: { price: number } | null;
    };

    expect(data.quote).toMatchObject({
      price: TAPE[ticker].latestTrade.p,
      prevClose: SAVED[ticker].fridayClose,
      open: TAPE[ticker].dailyBar.o,
      asOf: "2026-09-14T14:47:33.000Z",
      ageMinutes: 0,
      live: true,
    });
    // Nothing to warn about, and Finnhub's refusal was never reached.
    expect(data.priceWarning).toBeUndefined();
    expect(data.apiErrors).toBeUndefined();
    expect(result.summary).not.toContain("⚠");
    // The chart is measured from the live price (to the cent), not Friday's close.
    expect(data.technicals?.price).toBe(Math.round(TAPE[ticker].latestTrade.p * 100) / 100);
  });

  it("NVDA reads below its 50-day — it was read as 2.68% above it", async () => {
    const { result } = await lookup("NVDA");
    const d50 = (result.data as { technicals: { sma: { d50: { value: number; pctFromPrice: number } } } }).technicals.sma.d50;
    // The same 50-day the saved result carried: the bars are the real ones.
    expect(d50.value).toBe(212.58);
    expect(d50.pctFromPrice).toBe(-0.96);
    const row = (result.data as { tickers: { summary: string }[] }).tickers[0].summary;
    expect(row).toContain("50-day $212.58 (-1.0%)");
    expect(row).not.toContain("⚠");
  });

  it("the source named on the result is the one that served the price", async () => {
    const { result } = await lookup("CEG");
    const providers = (result.sources as { provider: string; title: string }[]).filter((s) => s.title.includes("Real-Time Quote"));
    expect(providers).toEqual([expect.objectContaining({ provider: "Alpaca", title: "CEG Real-Time Quote" })]);
  });

  it("with Alpaca down as well, the words from that morning still lead the result", async () => {
    const { result } = await lookup("NVDA", "down");
    const data = result.data as { quote: unknown; priceWarning?: string; apiErrors?: string[] };
    expect(data.quote).toBeNull();
    expect(data.priceWarning).toBe(
      "Live price for $NVDA unavailable (the quote was rate-limited) — using the last close $218.29 (Fri, 09/11). " +
        "Distances to averages and levels are measured from that close, not today's price.",
    );
    expect(String(result.summary).startsWith("⚠ Live price for $NVDA unavailable")).toBe(true);
    expect(data.apiErrors?.[0]).toContain("Alpaca getSnapshots(1 symbols) 503");
    expect(data.apiErrors?.[0]).toContain(FINNHUB_429);
  });
});
