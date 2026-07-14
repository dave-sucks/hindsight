/**
 * GET /api/theses/:id/analyst-coverage
 *
 * Thin wrapper over getAnalystCoverageData — the standing Bullish/Neutral/
 * Bearish ratings snapshot (Finnhub) + the consensus price-target range (FMP)
 * for the thesis's ticker. This is the sheet's consensus-widget hydration
 * source: it's the slowest vendor (FMP), so it loads on its own boundary and
 * never blocks the price chart. Shaping logic lives in
 * lib/actions/analyst-coverage.ts.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getAnalystCoverageData } from "@/lib/actions/analyst-coverage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const accountId = await getAccountId(user.id);
  if (!accountId)
    return NextResponse.json({ error: "No account" }, { status: 403 });

  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: { ticker: true },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(await getAnalystCoverageData(thesis.ticker));
}
