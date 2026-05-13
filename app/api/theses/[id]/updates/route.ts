/**
 * GET /api/theses/:id/updates
 *
 * Returns the activity log for one thesis, newest-first. Powers the
 * Timeline section inside ThesisSheet. Scoped to the requesting user —
 * never returns another user's thesis history.
 *
 * Query: ?limit=N (default 50, max 200).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

export async function GET(
  req: NextRequest,
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
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  // Verify ownership via Thesis.accountId before exposing updates. We don't
  // index ThesisUpdate by accountId — the join through Thesis is the only
  // scope check.
  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: { id: true },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );

  const updates = await prisma.thesisUpdate.findMany({
    where: { thesisId: id },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      id: true,
      timestamp: true,
      type: true,
      summary: true,
      rationale: true,
      fieldChanges: true,
      priceAtTime: true,
      positionAtTime: true,
      triggerId: true,
      signalIds: true,
      runId: true,
      tradeId: true,
    },
  });

  return NextResponse.json({ updates });
}
