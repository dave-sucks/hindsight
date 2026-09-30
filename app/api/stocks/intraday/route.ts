import { NextRequest, NextResponse } from "next/server";
import { getIntradayCandles, getStockQuote } from "@/lib/actions/finnhub.actions";

// GET /api/stocks/intraday?symbol=ARQT
// One-minute bars for the most recent session, trimmed to the chart's clock
// window — the poll target for the thesis sheet chart's "1D" tab, ~30s while
// the tab is open. Public market data, no auth (matches /api/quotes).
//
// `prevClose` rides along from the same quote the sheet header reads, so the
// line is colored against the prior session's close and agrees with the
// header's day change (DAV-340 review). Null when no quote answered.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json({ candles: [], prevClose: null });
  }

  const [candles, quote] = await Promise.all([
    getIntradayCandles(symbol),
    getStockQuote(symbol).catch(() => null),
  ]);
  const prevClose = quote && quote.pc > 0 ? quote.pc : null;
  return NextResponse.json({ candles, prevClose });
}
