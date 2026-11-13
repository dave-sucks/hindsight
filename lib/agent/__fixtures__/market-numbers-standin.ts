/**
 * Stand-in market inputs: made-up closing prices for the two index funds, the
 * 11 sector funds and VIXY at Wednesday Nov 11's close, SPY's 06:30 snapshot
 * row (as of Tuesday's close), and a calendar with one book stock reporting.
 * Built as live-quote.ts builds a quote after the bell: the close, stamped at 4 PM.
 */
import type { LiveQuoteResult } from "@/lib/market-data/live-quote";
import { buildMarketNumbers } from "@/lib/market-data/market-numbers";

/** The quotes, stamped at `printedAt` (by default 4 PM ET, Wed Nov 11: that day's close). */
export function standinMarketQuotes(printedAt = "2026-11-11T21:00:00Z"): Record<string, LiveQuoteResult> {
  const t = Date.parse(printedAt) / 1000;
  const close = (c: number, pc: number): LiveQuoteResult => ({
    quote: { c, t, pc, d: c - pc, dp: ((c - pc) / pc) * 100, o: pc, h: Math.max(c, pc), l: Math.min(c, pc), source: "alpaca" },
  });
  return {
    SPY: close(600, 603),
    QQQ: close(500, 505),
    XLK: close(98.6, 100), XLF: close(99.6, 100), XLV: close(100.5, 100), XLY: close(99.1, 100), XLP: close(100.3, 100), XLE: close(100.8, 100),
    XLI: close(99.7, 100), XLB: close(99.9, 100), XLRE: close(100.1, 100), XLU: close(101.2, 100), XLC: close(99.4, 100),
    VIXY: close(20, 19.4),
  };
}
export const STANDIN_MARKET_QUOTES = standinMarketQuotes();

/** SPY's TickerIndicators row as the 06:30 job writes it, as of Tuesday Nov 10's close. */
export const STANDIN_SPY_ROW = {
  id: "spy_1110",
  ticker: "SPY",
  asOf: "2026-11-10",
  volumeFeed: "sip",
  computedAt: new Date("2026-11-11T11:30:00Z"),
  snapshot: { asOf: "2026-11-10", sma: { 20: 598, 50: 590, 150: 570, 200: 560 }, closes: [603], high20: 610, low20: 585, high52w: 615, low52w: 480, volumeAvg20: 50_000_000, rsVsSpy: { "1M": 0, "3M": 0, "6M": 0 }, gaps: [], atr14: 6 },
};

/** The earnings calendar as Finnhub answers it: MU reports Tue Nov 17 after the close; a stock off the book on Mon. */
export const STANDIN_CALENDAR = {
  earningsCalendar: [
    { symbol: "MU", date: "2026-11-17", hour: "amc", epsActual: null, epsEstimate: 3.1 },
    { symbol: "ZZZZ", date: "2026-11-16", hour: "bmo", epsActual: null, epsEstimate: 1 },
  ],
};

/** The numbers those inputs make for a book holding MU and watching ASML, read at 8 AM ET Thu Nov 12. */
export const STANDIN_MARKET_NUMBERS = buildMarketNumbers({
  now: new Date("2026-11-12T13:00:00Z"),
  quotes: STANDIN_MARKET_QUOTES,
  spy: STANDIN_SPY_ROW.snapshot as never,
  upcoming: new Map([["MU", { symbol: "MU", reportDate: "2026-11-17", hour: "amc", epsActual: null, epsEstimate: 3.1, surprisePct: null, revenueActual: null, revenueEstimate: null, quarter: null, year: null }]]),
  book: { held: ["MU"], watched: ["ASML"] },
});
