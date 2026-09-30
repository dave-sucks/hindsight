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

it("no symbol: empty, and no vendor call", async () => {
  expect(await (await GET(new NextRequest("http://localhost/api/stocks/intraday"))).json()).toEqual({ candles: [], prevClose: null });
  expect(getIntradayCandles).not.toHaveBeenCalled();
});
