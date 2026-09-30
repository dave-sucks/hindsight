/**
 * The sheet's 1W tab reads 15-minute bars and its 1M tab hourly ones, through
 * the one route: `timeframe=15Min` is honored, anything else is hourly.
 */
const getHourlyCandles = jest.fn();
jest.mock("@/lib/actions/finnhub.actions", () => ({
  getHourlyCandles: (...a: unknown[]) => getHourlyCandles(...a),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

beforeEach(() => getHourlyCandles.mockReset().mockResolvedValue([]));

it("1W asks for 15-minute bars over 8 days", async () => {
  await GET(new NextRequest("http://localhost/api/stocks/hourly?symbol=DOCU&timeframe=15Min&days=8"));
  expect(getHourlyCandles).toHaveBeenCalledWith("DOCU", 8, "15Min");
});

it("1M, and any unknown timeframe, is hourly over 31 days", async () => {
  await GET(new NextRequest("http://localhost/api/stocks/hourly?symbol=DOCU"));
  expect(getHourlyCandles).toHaveBeenCalledWith("DOCU", 31, "1Hour");
  await GET(new NextRequest("http://localhost/api/stocks/hourly?symbol=DOCU&timeframe=1Min"));
  expect(getHourlyCandles).toHaveBeenLastCalledWith("DOCU", 31, "1Hour");
});
