/**
 * get-market-context.vix-replay.test.ts — the market check stops calling
 * VIXY's share price "VIX" (DAV-339).
 *
 * 2026-09-28 08:00 ET, the PEAD Specialist's daily run asked for the market
 * and was told: "SPY $771.35 (+0.54%). VIX 16.6. Regime: NEUTRAL." Finnhub
 * refuses the VIX index on our plan ("Market data subscription required
 * for CFD indices"), so the tool had quietly quoted VIXY — an ETF of VIX
 * futures — and reported its $16.61 as the VIX level. Its regime read that
 * number against VIX thresholds: 16.61 is not under 16, so NEUTRAL. The
 * same morning every buy was sized under the playbook regime — SPY above
 * its 50- and 200-day averages — RISK_ON.
 *
 * Replayed through the tool's real entry point with that morning's numbers
 * (lib/agent/__fixtures__/market-context-2026-09-28.json): the vendor
 * answers the tool reported, and SPY's snapshot row as of the 09-25 close.
 * Since #733 the quotes come from one live batch (getLiveQuotes, Alpaca's
 * tape); Finnhub is left with the earnings calendar and, on main, the
 * index it refuses.
 */
import raw from "@/lib/agent/__fixtures__/market-context-2026-09-28.json";
import { replayTool } from "@/lib/replay";

type Sector = { symbol: string; changePct: number };
const fx = raw as unknown as {
  at: string;
  result: {
    summary: string;
    data: {
      spy: { price: number; changePct: number; dayHigh: number; dayLow: number; asOf: string };
      vix: { level: number; changePct: number };
      sectors: Sector[];
      earningsDensity: { count: number };
    };
  };
  finnhubVixAnswer: Record<string, unknown>;
  spySnapshotRow: { ticker: string; asOf: string; volumeFeed: string; snapshot: Record<string, unknown> };
};
const d = fx.result.data;

/** The live batch as it priced that morning, rebuilt from what the tool reported. */
function liveQuotesThatMorning() {
  const t = Math.floor(Date.parse(d.spy.asOf) / 1000);
  const quote = (c: number, dp: number, h = c, l = c) => ({
    quote: { c, dp, h, l, o: c, pc: c, d: 0, t, source: "alpaca" as const },
  });
  const quotes: Record<string, object> = {
    SPY: quote(d.spy.price, d.spy.changePct, d.spy.dayHigh, d.spy.dayLow),
    // The fund, not the index: its $16.61 is what the old line called "VIX".
    VIXY: quote(d.vix.level, d.vix.changePct),
    ...Object.fromEntries(d.sectors.map((s) => [s.symbol, quote(100, s.changePct)])),
  };
  return () => ({
    ...jest.requireActual("@/lib/market-data/live-quote"),
    getLiveQuotes: jest.fn(async (symbols: string[]) =>
      Object.fromEntries(symbols.map((s) => [s, quotes[s] ?? { quote: null, error: "not quoted" }])),
    ),
  });
}

/** Finnhub as it answered that morning: the earnings calendar, and a refusal for the index. */
function finnhubThatMorning(asked: string[]) {
  return async (path: string) => {
    asked.push(path);
    const symbol = decodeURIComponent(path.match(/symbol=([^&]+)/)?.[1] ?? "");
    if (path.startsWith("/quote")) return { data: symbol === "^VIX" ? fx.finnhubVixAnswer : null };
    if (path.startsWith("/calendar/earnings")) {
      return { data: { earningsCalendar: Array.from({ length: d.earningsDensity.count }, (_, i) => ({ symbol: `E${i}` })) } };
    }
    return { data: null };
  };
}

async function marketCheckAt0800() {
  const asked: string[] = [];
  jest.useFakeTimers({
    now: new Date(fx.at),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    const replay = await replayTool("get-market-context", "getMarketContext", {
      seed: { tickerIndicators: [{ id: "spy_0925", computedAt: new Date("2026-09-28T10:30:22Z"), ...fx.spySnapshotRow }] },
      mocks: {
        "@/lib/agent/research-helpers": () => ({
          ...jest.requireActual("@/lib/agent/research-helpers"),
          finnhub: finnhubThatMorning(asked),
        }),
        "@/lib/market-data/live-quote": liveQuotesThatMorning(),
      },
      args: {},
    });
    return { ...replay, asked };
  } finally {
    jest.useRealTimers();
  }
}

describe("2026-09-28 08:00 ET — the market check the PEAD Specialist's run read", () => {
  it("VIXY is reported as itself, by its day's move — never as the VIX level", async () => {
    const { result, asked } = await marketCheckAt0800();
    // On main: "SPY $771.35 (+0.54%). VIX 16.6. Regime: NEUTRAL. 94 earnings …"
    expect(result.summary).not.toContain("VIX 16.6");
    expect(result.summary).toContain("VIXY -1.72% today (VIX futures ETF; not the VIX level)");
    expect(result.data).toMatchObject({ vixy: { price: 16.61, changePct: -1.716 } });
    expect(result.data).not.toHaveProperty("vix");
    // No plan serves the index, so the tool stops asking for it.
    expect(asked.some((p) => /%5EVIX|\^VIX/.test(p))).toBe(false);
  });

  it("the regime is the one sizing used that morning — SPY against its averages, as of the last close", async () => {
    const { result } = await marketCheckAt0800();
    // On main: NEUTRAL, from VIXY's price read against VIX thresholds.
    expect(result.data).toMatchObject({ regime: "RISK_ON", regimeAsOf: "2026-09-25" });
    expect(result.summary).toContain(
      "Market risk-on: SPY $771.35, above its 50-day ($761.57) and above its 200-day ($718.45), so full size (as of the 2026-09-25 close)",
    );
    // What was right that morning is unchanged.
    expect(result.summary).toContain("SPY $771.35 (+0.54%)");
    expect(result.data?.sectors).toEqual(d.sectors);
  });

  it("with no SPY snapshot it says the regime is unavailable instead of guessing one", async () => {
    const asked: string[] = [];
    const { result } = await replayTool("get-market-context", "getMarketContext", {
      seed: { tickerIndicators: [] },
      mocks: {
        "@/lib/agent/research-helpers": () => ({
          ...jest.requireActual("@/lib/agent/research-helpers"),
          finnhub: finnhubThatMorning(asked),
        }),
        "@/lib/market-data/live-quote": liveQuotesThatMorning(),
      },
      args: {},
    });
    expect(result.data).toMatchObject({ regime: null, regimeLine: null });
    expect(result.summary).toContain("The market regime is unavailable: no SPY reading in today's indicator snapshot.");
  });
});
