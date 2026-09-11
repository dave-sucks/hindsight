/**
 * GET /api/earnings?date=YYYY-MM-DD
 *
 * One day's reporters with the numbers, plus counts for the week around
 * it — the data behind the /earnings page. Live from the vendor on every
 * request (cached 5 minutes upstream); nothing stored. Scoped to the
 * requesting user's book so our names sort first and each row knows which
 * analysts already cover it.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getEarningsDay } from "@/lib/market-data/earnings-calendar";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!DAY.test(date)) return NextResponse.json({ error: "Bad date" }, { status: 400 });

  // The book: every held or watched name, with the analysts on it.
  const theses = await prisma.thesis.findMany({
    where: { accountId, status: { in: ["HOLDING", "WATCHING"] } },
    select: { ticker: true, researchRun: { select: { agentConfigId: true } } },
  });
  const coveredBy = new Map<string, string[]>();
  for (const t of theses) {
    const id = t.researchRun.agentConfigId;
    const key = t.ticker.toUpperCase();
    const list = coveredBy.get(key) ?? [];
    if (id && !list.includes(id)) list.push(id);
    coveredBy.set(key, list);
  }

  const view = await getEarningsDay({ date, coveredBy });
  return NextResponse.json(view);
}
