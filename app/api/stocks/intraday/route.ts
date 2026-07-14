import { NextRequest, NextResponse } from "next/server";
import { getIntradayCandles } from "@/lib/actions/finnhub.actions";

// GET /api/stocks/intraday?symbol=ARQT
// 5-minute candles for the most recent trading session — the poll target for
// the thesis sheet chart's "1D" tab. Public market data, no auth (matches
// /api/quotes and /api/stocks/candles). Polled ~30s while the 1D tab is open.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json({ candles: [] });
  }

  const candles = await getIntradayCandles(symbol);
  return NextResponse.json({ candles });
}
