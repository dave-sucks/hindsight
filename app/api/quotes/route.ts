import { NextRequest, NextResponse } from "next/server";
import { getStockQuote } from "@/lib/actions/finnhub.actions";

// GET /api/quotes?symbols=SPY,QQQ,IWM
// Used as fallback when Finnhub WebSocket is unavailable (markets closed, rate limit)
//
// Goes through `getStockQuote` rather than fetching Finnhub inline. This route
// is polled every 30s by `useMarketPulse` on every open tab, so an inline
// uncached fetch here would multiply upstream calls by the number of tabs and
// blow Finnhub's 60/min limit. `getStockQuote`'s short in-memory cache +
// in-flight coalescing collapse that back to one call per symbol per ~10s,
// while still never touching the persistent Data Cache (see CLAUDE.md →
// "NEVER put a live quote in the Next.js Data Cache").
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  if (!symbolsParam) {
    return NextResponse.json({ quotes: [] });
  }

  const symbols = symbolsParam.split(",").filter(Boolean).slice(0, 20); // cap at 20

  if (!process.env.FINNHUB_API_KEY && !process.env.NEXT_PUBLIC_FINNHUB_API_KEY) {
    return NextResponse.json({ error: "Finnhub API key not configured" }, { status: 500 });
  }

  // allSettled, not all: one bad symbol must not fail the whole strip.
  // `getStockQuote` swallows its own errors today, but this route's contract
  // ("a failed symbol resolves to zeros") shouldn't silently depend on that.
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const q = await getStockQuote(symbol);
      return {
        symbol,
        price: q?.c ?? 0,       // current price
        change: q?.d ?? 0,      // $ change from prev close
        changePct: q?.dp ?? 0,  // % change from prev close
        prevClose: q?.pc ?? 0,
      };
    })
  );

  const quotes = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { symbol: symbols[i], price: 0, change: 0, changePct: 0, prevClose: 0 },
  );

  return NextResponse.json({ quotes });
}
