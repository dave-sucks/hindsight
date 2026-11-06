/**
 * get-market-context.nov2-replay.test.ts: the market check names the
 * market's own dates.
 *
 * Mon 2026-11-02, 8:01 AM ET, the day before the midterms. The PEAD
 * Specialist's morning run asked for the market and was told:
 * "SPY $755.72 (-1.77%). VIXY +10.50% today (VIX futures ETF; not the VIX
 * level). Market cautious: … (as of the 2026-10-30 close). 1500 earnings
 * 11/2–11/7." Nothing about the vote the next day, no VIX level, and a
 * count that was only where Finnhub stops its list. Five of our holdings,
 * 41% of the account, fell 11–22% in the two days after the vote.
 *
 * Replayed through the tool's real entry point with that morning's inputs
 * (lib/agent/__fixtures__/market-context-2026-11-02.json): the recorded
 * quotes, SPY's snapshot row as of the Oct 30 close, and Cboe's VIX and TNX
 * files as they ended that morning. Finnhub's market news and Polymarket's
 * odds from that morning weren't recorded, so the replay has them fail, and
 * the check must say so.
 */
import raw from "@/lib/agent/__fixtures__/market-context-2026-11-02.json";
import { replayTool } from "@/lib/replay";

type Sector = { symbol: string; changePct: number };
const fx = raw as unknown as {
  at: string;
  result: {
    summary: string;
    data: {
      spy: { price: number; changePct: number; dayHigh: number; dayLow: number; asOf: string };
      vixy: { price: number; changePct: number };
      sectors: Sector[];
      earningsDensity: { count: number };
    };
  };
  spySnapshotRow: { ticker: string; asOf: string; volumeFeed: string; snapshot: Record<string, unknown> };
  cboe: { VIX: string; TNX: string };
};
const d = fx.result.data;

function liveQuotesThatMorning() {
  const t = Math.floor(Date.parse(d.spy.asOf) / 1000);
  const quote = (c: number, dp: number, h = c, l = c) => ({
    quote: { c, dp, h, l, o: c, pc: c, d: 0, t, source: "alpaca" as const },
  });
  const quotes: Record<string, object> = {
    SPY: quote(d.spy.price, d.spy.changePct, d.spy.dayHigh, d.spy.dayLow),
    VIXY: quote(d.vixy.price, d.vixy.changePct),
    ...Object.fromEntries(d.sectors.map((s) => [s.symbol, quote(100, s.changePct)])),
  };
  return () => ({
    ...jest.requireActual("@/lib/market-data/live-quote"),
    getLiveQuotes: jest.fn(async (symbols: string[]) =>
      Object.fromEntries(symbols.map((s) => [s, quotes[s] ?? { quote: null, error: "not quoted" }])),
    ),
  });
}

async function marketCheckNov2() {
  const fetched: string[] = [];
  const realFetch = global.fetch;
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    const u = String(url);
    fetched.push(u);
    const index = u.match(/daily_prices\/(VIX|TNX)_History\.csv$/)?.[1] as "VIX" | "TNX" | undefined;
    if (index) return new Response(fx.cboe[index], { status: 200 });
    throw new Error("not recorded for this replay");
  }) as typeof fetch;
  jest.useFakeTimers({
    now: new Date(fx.at),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    return await replayTool("get-market-context", "getMarketContext", {
      seed: { tickerIndicators: [{ id: "spy_1030", computedAt: new Date("2026-11-02T11:30:52Z"), ...fx.spySnapshotRow }] },
      mocks: {
        "@/lib/agent/research-helpers": () => ({
          ...jest.requireActual("@/lib/agent/research-helpers"),
          finnhub: async (path: string) =>
            path.startsWith("/calendar/earnings")
              ? { data: { earningsCalendar: Array.from({ length: d.earningsDensity.count }, (_, i) => ({ symbol: `E${i}`, date: "2026-11-04" })) } }
              : { data: null, error: "not recorded for this replay" },
        }),
        "@/lib/market-data/live-quote": liveQuotesThatMorning(),
      },
      args: {},
    });
  } finally {
    jest.useRealTimers();
    global.fetch = realFetch;
  }
}

describe("Mon 2026-11-02 8:01 AM ET: the market check the morning before the midterms", () => {
  it("names the vote the next day, and the reports after it", async () => {
    const { result } = await marketCheckNov2();
    // On main the check said nothing about any date.
    expect(fx.result.summary).not.toMatch(/election|Nov 3/);
    expect(result.summary).toContain(
      "Market dates, next 3 weeks: Tue Nov 3 US midterm elections; Fri Nov 6 jobs report; Tue Nov 10 inflation report (CPI)",
    );
    expect(result.summary).toContain("Next Fed decision Wed Dec 9");
    expect(result.data).toMatchObject({
      calendar: [
        { date: "2026-11-03", kind: "ELECTION" },
        { date: "2026-11-06", kind: "JOBS" },
        { date: "2026-11-10", kind: "CPI" },
      ],
    });
  });

  it("reads the VIX and the 10-year yield at the Friday close, and says it was Friday's", async () => {
    const { result } = await marketCheckNov2();
    expect(result.summary).toContain("VIX 19.42 at the Fri Oct 30 close (17.20 the close before)");
    expect(result.summary).toContain("10-year Treasury yield 4.93% at the Fri Oct 30 close (-6 bp)");
    // VIXY keeps its own line, by its day's move only.
    expect(result.summary).toContain("VIXY +10.50% today (VIX futures ETF; not the VIX level)");
  });

  it("says the earnings count is a floor when Finnhub's list stops at 1,500", async () => {
    const { result } = await marketCheckNov2();
    expect(fx.result.summary).toContain("1500 earnings 11/2–11/7.");
    expect(result.summary).toContain("1,500+ earnings 11/2–11/7 (the vendor's list stops at 1,500)");
  });

  it("says in words when the headlines and the Fed odds didn't come back", async () => {
    const { result } = await marketCheckNov2();
    expect(result.summary).toContain("⚠ No market headlines: not recorded for this replay.");
    expect(result.summary).toContain("⚠ No betting odds on the next Fed decision: Polymarket: not recorded for this replay.");
    // What was right that morning is unchanged.
    expect(result.summary).toContain("SPY $755.72 (-1.77%)");
    expect(result.summary).toContain("Market cautious");
  });
});
