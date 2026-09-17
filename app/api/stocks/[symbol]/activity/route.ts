/**
 * GET /api/stocks/:symbol/activity
 *
 * Volume against its 20-day average, and open-market insider buying —
 * the two reads the VOLUME_RATIO and INSIDER_CLUSTER triggers fire on,
 * for any stock. The stock page renders the same function server-side.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getInsiderBuying, getStockVolume } from "@/lib/market-data/stock-activity";

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
  const [volume, insiders] = await Promise.all([getStockVolume(symbol), getInsiderBuying(symbol)]);
  return NextResponse.json({ symbol: symbol.toUpperCase(), volume, insiders });
}
