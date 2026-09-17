/**
 * GET /api/filings?date=YYYY-MM-DD
 *
 * The week of SEC filings around a date — your book's filings, then the
 * material and serious filings of listed companies across the market — with
 * per-day counts. The data behind the Filings view on /earnings. Live off
 * EDGAR, held five minutes per week; nothing stored.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getBookCoverage } from "@/lib/actions/book-coverage";
import { getFilingsWeek } from "@/lib/market-data/sec-filings";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const date = new URL(req.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!DAY.test(date)) return NextResponse.json({ error: "Bad date" }, { status: 400 });

  const coveredBy = await getBookCoverage(accountId);
  return NextResponse.json(await getFilingsWeek({ date, coveredBy }));
}
