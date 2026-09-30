/**
 * The 1D chart's poll target hands back the prior session's close beside the
 * bars, from the same quote the sheet header reads — so the line's color and
 * the header's day change come from one number (DAV-340 review).
 */
const getIntradayCandles = jest.fn();
const getStockQuote = jest.fn();
jest.mock("@/lib/actions/finnhub.actions", () => ({
  getIntradayCandles: (...a: unknown[]) => getIntradayCandles(...a),
  getStockQuote: (...a: unknown[]) => getStockQuote(...a),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const bar = { date: "2026-09-29T13:30:00Z", open: 18.87, high: 19.09, low: 18.01, close: 18.12, volume: 25_072 };

beforeEach(() => {
  getIntradayCandles.mockReset().mockResolvedValue([bar]);
  getStockQuote.mockReset().mockResolvedValue({ c: 16.475, d: 0.995, dp: 6.43, h: 19.09, l: 16.15, o: 18.91, pc: 15.48, t: 1_790_708_859 });
});

it("SMMT 2026-09-29: the bars and Monday's close, $15.48", async () => {
  const res = await GET(new NextRequest("http://localhost/api/stocks/intraday?symbol=smmt"));
  expect(await res.json()).toEqual({ candles: [bar], prevClose: 15.48 });
  expect(getStockQuote).toHaveBeenCalledWith("smmt");
});

it("no quote, or a quote with no prior close, is null — never a zero the chart would color against", async () => {
  getStockQuote.mockResolvedValue(null);
  expect(await (await GET(new NextRequest("http://localhost/api/stocks/intraday?symbol=SMMT"))).json()).toEqual({ candles: [bar], prevClose: null });
  getStockQuote.mockResolvedValue({ c: 16.475, pc: 0, t: 0 });
  expect((await (await GET(new NextRequest("http://localhost/api/stocks/intraday?symbol=SMMT"))).json()).prevClose).toBeNull();
  getStockQuote.mockRejectedValue(new Error("vendor down"));
  expect((await (await GET(new NextRequest("http://localhost/api/stocks/intraday?symbol=SMMT"))).json()).prevClose).toBeNull();
});

describe("before the open, today is colored against yesterday's close", () => {
  // Tuesday 2026-09-29 closed at $16.39 (Monday: $15.48). Wednesday 07:30 ET,
  // pre-market: the quote is still Tuesday's close, stamped at Tuesday's
  // bell, with Monday's close as its prior close.
  const tuesdayCloseQuote = { c: 16.39, d: 0.91, dp: 5.88, h: 19.09, l: 16.15, o: 18.91, pc: 15.48, t: Math.floor(new Date("2026-09-29T20:00:00Z").getTime() / 1000) };
  const wednesdayPreMarket = { date: "2026-09-30T11:30:00Z", open: 16.1, high: 16.12, low: 16.05, close: 16.06, volume: 4_200 };

  it("a gap down after an up day is red: the baseline is $16.39, not Monday's $15.48", async () => {
    getIntradayCandles.mockResolvedValue([wednesdayPreMarket]);
    getStockQuote.mockResolvedValue(tuesdayCloseQuote);
    const body = await (await GET(new NextRequest("http://localhost/api/stocks/intraday?symbol=SMMT"))).json();
    expect(body.prevClose).toBe(16.39);
    expect(body.candles[0].close).toBeLessThan(body.prevClose);
  });

  it("after the open the bars and the quote are the same day, and the quote's prior close is the baseline", async () => {
    getIntradayCandles.mockResolvedValue([{ ...wednesdayPreMarket, date: "2026-09-30T13:45:00Z" }]);
    getStockQuote.mockResolvedValue({ ...tuesdayCloseQuote, c: 16.2, pc: 16.39, t: Math.floor(new Date("2026-09-30T13:45:10Z").getTime() / 1000) });
    const body = await (await GET(new NextRequest("http://localhost/api/stocks/intraday?symbol=SMMT"))).json();
    expect(body.prevClose).toBe(16.39);
  });

  it("a weekend shows Friday's day against Thursday's close — the quote's prior close, same day as the bars", async () => {
    getIntradayCandles.mockResolvedValue([{ ...wednesdayPreMarket, date: "2026-10-02T21:30:00Z" }]); // Friday after-hours
    getStockQuote.mockResolvedValue({ c: 16.5, d: 0.2, dp: 1.23, h: 16.6, l: 16.1, o: 16.2, pc: 16.3, t: Math.floor(new Date("2026-10-02T20:00:00Z").getTime() / 1000) });
    const body = await (await GET(new NextRequest("http://localhost/api/stocks/intraday?symbol=SMMT"))).json();
    expect(body.prevClose).toBe(16.3);
  });
});

it("no symbol: empty, and no vendor call", async () => {
  expect(await (await GET(new NextRequest("http://localhost/api/stocks/intraday"))).json()).toEqual({ candles: [], prevClose: null });
  expect(getIntradayCandles).not.toHaveBeenCalled();
});
