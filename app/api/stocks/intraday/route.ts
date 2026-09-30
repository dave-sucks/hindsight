import { NextRequest, NextResponse } from "next/server";
import { getIntradayCandles, getStockQuote } from "@/lib/actions/finnhub.actions";
import { etDateOf } from "@/lib/market-data/intraday-window";

// GET /api/stocks/intraday?symbol=ARQT
// One-minute bars for the most recent session, trimmed to the chart's clock
// window — the poll target for the thesis sheet chart's "1D" tab, ~30s while
// the tab is open. Public market data, no auth (matches /api/quotes).
//
// `prevClose` rides along from the same quote the sheet header reads, so the
// line is colored against the prior session's close and agrees with the
// header's day change (DAV-340 review). Null when no quote answered.
//
// Before the open the quote is the last finished session — its price is
// yesterday's close, stamped at yesterday's bell, and its prior close is the
// day before's — while the bars are today's pre-market. Today is colored
// against yesterday's close, the quote's own price, not the day before's:
// otherwise a gap down after an up day reads green. After the open the bars
// and the quote are the same day and the quote's prior close is right.
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
  const barsDay = candles.length ? etDateOf(candles[candles.length - 1].date) : null;
  const quoteDay = quote && quote.t > 0 ? etDateOf(new Date(quote.t * 1000)) : null;
  const baseline = barsDay && quoteDay && barsDay > quoteDay ? quote?.c : quote?.pc;
  const prevClose = typeof baseline === "number" && baseline > 0 ? baseline : null;
  return NextResponse.json({ candles, prevClose });
}
