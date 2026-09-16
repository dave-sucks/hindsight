/**
 * GET /api/stocks/:symbol/filings
 *
 * One company's SEC filings — what it told the SEC and what each filing is,
 * read live off EDGAR. Nothing stored. Feeds the stock page's Filings tab.
 * The thesis-scoped twin (/api/theses/:id/filings) resolves the ticker and
 * calls the same function. See docs/plans/SEC_FILINGS.md §8.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFilingsForSymbol } from "@/lib/market-data/sec-filings";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^[A-Za-z.\-]{1,10}$/.test(symbol)) {
    return NextResponse.json({ error: "Bad symbol" }, { status: 400 });
  }
  const days = Number(new URL(req.url).searchParams.get("days"));
  return NextResponse.json(
    await getFilingsForSymbol(symbol, {
      days: Number.isInteger(days) && days > 0 && days <= 365 ? days : undefined,
    }),
  );
}
