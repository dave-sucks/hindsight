/**
 * GET /api/movers?kind=gainers|losers|active
 *
 * Today's movers with names, price, the day's move and volume — the data
 * behind /movers and the dashboard's movers card. Live; nothing stored.
 * Rows on your book carry the analysts that cover them.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getBookCoverage } from "@/lib/actions/book-coverage";
import { getMoversView, type MoverKind } from "@/lib/market-data/movers";

const KINDS: MoverKind[] = ["gainers", "losers", "active"];

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const kind = (new URL(req.url).searchParams.get("kind") ?? "gainers") as MoverKind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "Bad kind" }, { status: 400 });

  const coveredBy = await getBookCoverage(accountId);
  return NextResponse.json(await getMoversView(kind, { coveredBy }));
}
