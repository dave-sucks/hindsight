import { NextRequest, NextResponse } from "next/server";
import { getHourlyCandles } from "@/lib/actions/finnhub.actions";

// GET /api/stocks/hourly?symbol=CRWD&days=31&timeframe=1Hour
// Hourly bars for the sheet chart's 1M tab, 15-minute bars (timeframe=15Min)
// for its 1W tab — denser than daily so those short ranges read like a real
// finance chart instead of ~3–22 dots. Public market data, no auth (matches
// /api/stocks/candles + /api/stocks/intraday).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json({ candles: [] });
  }

  const daysRaw = Number(searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 60) : 31;

  const timeframe = searchParams.get("timeframe") === "15Min" ? "15Min" : "1Hour";
  const candles = await getHourlyCandles(symbol, days, timeframe);
  return NextResponse.json({ candles });
}
