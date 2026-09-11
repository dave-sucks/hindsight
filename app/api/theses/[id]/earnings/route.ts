/**
 * GET /api/theses/:id/earnings
 *
 * The earnings layer for a thesis — next report, last report, EPS history —
 * read live from the vendor when the sheet opens, the same way the price
 * header is a live quote. Nothing persisted: what the system DID about a
 * report is on the activity log already. See docs/plans/MARKET_DATA.md §2.
 *
 * Resolves the ticker (scoped to the requesting user) and hands off to the
 * same function the stock page uses.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getEarningsForSymbol } from "@/lib/market-data/earnings-calendar";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: { ticker: true },
  });
  if (!thesis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(await getEarningsForSymbol(thesis.ticker));
}
