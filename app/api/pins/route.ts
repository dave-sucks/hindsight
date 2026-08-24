import { NextResponse } from "next/server";
import { getPinnedTickers } from "@/lib/actions/pins.actions";

// GET /api/pins → { tickers: ["NVDA", "EME", ...] }
//
// Read side for the client-side pin cache (hooks/usePinned.ts). Every trade
// row in the app offers Pin/Unpin in its kebab, so the rows need pin state
// without every call site plumbing it down as a prop. One fetch per page load,
// shared by every row, same shape as the quote cache.
export async function GET() {
  try {
    const tickers = await getPinnedTickers();
    return NextResponse.json({ tickers });
  } catch {
    return NextResponse.json({ tickers: [] });
  }
}
