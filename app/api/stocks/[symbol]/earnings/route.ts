/**
 * GET /api/stocks/:symbol/earnings
 *
 * One company's earnings: next report, last report (with revenue), EPS
 * history. Live from the vendor; nothing stored. Feeds the stock page's
 * Earnings tab. The thesis-scoped twin (/api/theses/:id/earnings) resolves
 * the ticker and calls the same function.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEarningsForSymbol } from "@/lib/market-data/earnings-calendar";

export async function GET(
  _req: Request,
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
  return NextResponse.json(await getEarningsForSymbol(symbol));
}
