/**
 * GET /api/stocks/:symbol/profile
 *
 * The company's numbers for the Data tab: who it is (exchange, industry,
 * IPO, website), the key stats, and the financials by section. Built from
 * the same functions the stock page calls server-side (lib/stocks/stock-stats),
 * so a number reads the same on the sheet and on the page. Live from the
 * vendor: the profile and metrics are cached an hour, the quote never is.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStockInfo } from "@/lib/actions/stock-info";
import { getStockMetrics, getStockProfile, getStockQuote } from "@/lib/actions/finnhub.actions";
import { financialStatSections, keyStatColumns } from "@/lib/stocks/stock-stats";
import type { StockProfileResponse } from "@/lib/types/thesis-sheet";

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
  const S = symbol.toUpperCase();
  const [identity, profile, metrics, quote] = await Promise.all([
    getStockInfo(S),
    getStockProfile(S),
    getStockMetrics(S),
    getStockQuote(S),
  ]);
  const marketCap = profile?.marketCap
    ? profile.marketCap * 1_000_000
    : metrics?.["marketCapitalization"]
      ? metrics["marketCapitalization"] * 1_000_000
      : null;
  const website = profile?.weburl ? profile.weburl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : null;
  const body: StockProfileResponse = {
    symbol: S,
    about: {
      exchange: identity.exchange ?? null,
      industry: profile?.finnhubIndustry || null,
      ipo: profile?.ipo || null,
      website,
      url: profile?.weburl || null,
    },
    keyStats: keyStatColumns(quote, metrics, marketCap),
    financials: financialStatSections(metrics, marketCap),
  };
  return NextResponse.json(body);
}
