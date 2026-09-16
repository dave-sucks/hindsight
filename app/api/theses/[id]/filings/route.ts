/**
 * GET /api/theses/:id/filings
 *
 * The filings layer for a thesis — what this company has told the SEC
 * lately — read live when the sheet opens, the same way the price header is
 * a live quote. Nothing persisted: what the system DID about a filing is on
 * the activity log. See docs/plans/SEC_FILINGS.md §8.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getFilingsForSymbol } from "@/lib/market-data/sec-filings";

/** The sheet's line covers the last month — a filing older than that is history. */
const SHEET_DAYS = 30;

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

  return NextResponse.json(await getFilingsForSymbol(thesis.ticker, { days: SHEET_DAYS }));
}
