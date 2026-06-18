import { NextRequest, NextResponse } from "next/server";
import { getStockCandlesBatch } from "@/lib/actions/finnhub.actions";

// GET /api/stocks/candles?symbols=NVDA,AMD&days=30
// Batched daily candles for the thesis-card feed (one call for the whole
// visible list) and the thesis sheet (called with a single symbol on open).
// Public market data — no auth, matching /api/quotes. Returns a map keyed by
// uppercased symbol; symbols with no bars are simply absent.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  if (!symbolsParam) {
    return NextResponse.json({ candles: {} });
  }

  const symbols = symbolsParam.split(",").filter(Boolean).slice(0, 30); // cap at 30
  const daysRaw = Number(searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 400) : 30;

  const candles = await getStockCandlesBatch(symbols, days);
  return NextResponse.json({ candles });
}
