/**
 * The market numbers: written by code, read by get_market_context, every
 * agent's Market and portfolio block and the Market Reviewer's first message.
 * Through the entry points, from one stood-in quote set (stand-in prices,
 * lib/agent/__fixtures__/market-numbers-standin.ts): the tool and the block
 * report the same numbers, and a part that can't be read says so.
 */
import { prismaDouble, replayTool, thesisRow } from "@/lib/replay";
import { STANDIN_CALENDAR, STANDIN_MARKET_NUMBERS, STANDIN_SPY_ROW, standinMarketQuotes } from "@/lib/agent/__fixtures__/market-numbers-standin";
import { buildMarketNumbers, marketNumbersText } from "@/lib/market-data/market-numbers";

const NOW = new Date("2026-11-12T13:00:00Z"); // 8 AM ET, Thu Nov 12
const ACCOUNT = "acct_live";
const quotes = standinMarketQuotes();
const liveQuotes = () => ({ getLiveQuotes: async (symbols: string[]) => Object.fromEntries(symbols.map((s) => [s, quotes[s] ?? { quote: null, error: "not stood in" }])) });
const calendar = (answer: { data: unknown; error?: string }) => () => ({
  ...jest.requireActual("@/lib/agent/research-helpers"),
  finnhub: async (path: string) => (path.startsWith("/calendar/earnings") ? answer : { data: null, error: "not stood in" }),
});
const inBook = (over: Record<string, unknown>) =>
  thesisRow({ ...over, researchRun: { agentConfigId: "analyst_1", agentConfig: { name: "Analyst One", setupIds: [], accountId: ACCOUNT, tradingEnvironment: "LIVE" } } });
const BOOK = [inBook({ id: "t_mu", ticker: "MU", status: "HOLDING" }), inBook({ id: "t_asml", ticker: "ASML", status: "WATCHING" })];

/** The block, through loadPortfolioBlock, with only the vendors and the broker stood in. */
async function block(finnhubAnswer: { data: unknown; error?: string } = { data: STANDIN_CALENDAR }): Promise<string> {
  let text = "";
  await jest.isolateModulesAsync(async () => {
    const db = prismaDouble({ tickerIndicators: [STANDIN_SPY_ROW], thesis: BOOK });
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/market-data/live-quote", liveQuotes);
    jest.doMock("@/lib/agent/research-helpers", calendar(finnhubAnswer));
    jest.doMock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: async () => null }));
    const { loadPortfolioBlock } = await import("@/lib/agent/portfolio-block");
    text = await loadPortfolioBlock({ accountId: ACCOUNT, environment: "LIVE", now: NOW });
  });
  return text;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["setTimeout", "clearTimeout", "setImmediate", "nextTick", "queueMicrotask"] });
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("one set of market numbers", () => {
  it("get_market_context and the block report the same numbers from one quote set", async () => {
    const { result } = await replayTool("get-market-context", "getMarketContext", {
      seed: { tickerIndicators: [STANDIN_SPY_ROW] },
      mocks: { "@/lib/market-data/live-quote": liveQuotes },
      args: {},
    });
    const tool = result.data as {
      spy: { price: number; changePct: number };
      qqq: { price: number; changePct: number };
      vixy: { changePct: number };
      regimeLine: string;
      sectors: Array<{ symbol: string; changePct: number }>;
    };
    const text = await block();
    const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
    expect(text).toContain(`S&P 500 (SPY) $${tool.spy.price.toFixed(2)} ${pct(tool.spy.changePct)} · Nasdaq 100 (QQQ) $${tool.qqq.price.toFixed(2)} ${pct(tool.qqq.changePct)}`);
    expect(text).toContain(tool.regimeLine.replace(/\.$/, ""));
    expect(text).toContain(`VIXY, a fund of VIX futures (not the VIX itself): ${pct(tool.vixy.changePct)}`);
    // The same sectors, in the same order, with the same moves.
    const line = text.split("\n").find((l) => l.startsWith("- Sectors on the day"))!;
    expect([...line.matchAll(/(XL[A-Z]+) [a-z ]+ ([+−][\d.]+%)/g)].map((m) => [m[1], m[2]])).toEqual(tool.sectors.map((s) => [s.symbol, pct(s.changePct)]));
    expect(tool.sectors).toHaveLength(11);
  });

  it("the block's first part is the numbers, read for this book: its held and watched stocks' coming reports", async () => {
    const text = await block();
    expect(text.split("\n").slice(0, 9).join("\n")).toBe(
      [
        "## Market and portfolio",
        "",
        "### Market numbers (as of Thu, Nov 12, 8:00 AM ET)",
        "- S&P 500 (SPY) $600.00 −0.50% · Nasdaq 100 (QQQ) $500.00 −0.99%, at Wednesday's close, Nov 11.",
        "- Market risk-on: SPY $603.00, above its 50-day ($590.00) and above its 200-day ($560.00), so full size (as of Tuesday's close, Nov 10).",
        "- Sectors on the day, best to worst: XLU utilities +1.20%, XLE energy +0.80%, XLV health care +0.50%, XLP staples +0.30%, XLRE real estate +0.10%, XLB materials −0.10%, XLI industrials −0.30%, XLF financials −0.40%, XLC communications −0.60%, XLY discretionary −0.90%, XLK tech −1.40%.",
        "- VIXY, a fund of VIX futures (not the VIX itself): +3.09% on the day.",
        // ZZZZ reports too, but it isn't ours.
        "- Our stocks reporting in the next 14 days: MU (held) Tue, Nov 17 after the close.",
        "",
      ].join("\n"),
    );
    expect(marketNumbersText(STANDIN_MARKET_NUMBERS)).toBe(text.split("\n").slice(3, 8).join("\n"));
  });

  it("a calendar that can't be read says so; it never reads as no reports", async () => {
    expect(await block({ data: null, error: "Finnhub /calendar/earnings rate limited (429)" })).toContain("- Report dates for our stocks couldn't be read for this request.");
    expect(await block({ data: { earningsCalendar: [] } })).toContain("- None of our held or watched stocks reports in the next 14 days.");
  });
});

describe("the text", () => {
  const at = (iso: string, over: Partial<Parameters<typeof buildMarketNumbers>[0]> = {}) =>
    marketNumbersText(buildMarketNumbers({ now: new Date(iso), quotes: standinMarketQuotes("2026-11-12T15:30:00Z"), spy: STANDIN_SPY_ROW.snapshot as never, ...over }));

  it("in the session, prices read as live; with no book there is no report line", () => {
    const text = at("2026-11-12T15:32:00Z"); // 10:32 AM ET
    expect(text).toContain("Nasdaq 100 (QQQ) $500.00 −0.99%, live.");
    expect(text).not.toContain("reporting");
  });

  it("a price that isn't current in the session says how old it is", () => {
    expect(at("2026-11-12T16:30:00Z")).toContain("Nasdaq 100 (QQQ) $500.00 −0.99%, not current (60 minutes old).");
  });

  it("an index, sector or VIXY with no quote is named, never left out", () => {
    const { QQQ, XLK, VIXY, ...rest } = standinMarketQuotes("2026-11-11T21:00:00Z");
    void QQQ, XLK, VIXY;
    const text = marketNumbersText(buildMarketNumbers({ now: NOW, quotes: { ...rest, QQQ: { quote: null, error: "no price" } }, spy: null }));
    expect(text).toContain("- S&P 500 (SPY) $600.00 −0.50%, at Wednesday's close, Nov 11 · Nasdaq 100 (QQQ) couldn't be priced.");
    expect(text).toContain("- Sectors on the day, best to worst (10 of 11 priced): XLU");
    expect(text).toContain("- VIXY's day move couldn't be read.");
    expect(text).toContain("- The regime is unavailable: no SPY reading in the daily indicator snapshot.");
  });
});
