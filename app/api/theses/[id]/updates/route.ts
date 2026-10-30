/**
 * GET /api/theses/:id/updates
 *
 * The stock's whole Activity feed, newest first: the saved lines plus each
 * proposal's steps built from its order (lib/thesis/activity-feed.ts). Powers
 * the Activity tab inside ThesisSheet. The dossier route reads the newest 8
 * of the same feed for the Overview, and the agents read those same 8.
 * Scoped to the requesting user.
 *
 * Query: ?limit=N (default 50, max 200).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { serializeFeedItem } from "@/lib/thesis/activity-feed";
import { loadActivityFeed } from "@/lib/thesis/activity-feed.server";

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

  // Ownership is checked through Thesis.accountId: the only scope on ThesisUpdate.
  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: {
      id: true,
      ticker: true,
      createdAt: true,
      closedAt: true,
      invalidatedAt: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );

  const feed = await loadActivityFeed(
    { id: thesis.id, ticker: thesis.ticker, createdAt: thesis.createdAt, closedAt: thesis.closedAt, invalidatedAt: thesis.invalidatedAt, analystId: thesis.researchRun?.agentConfigId ?? null },
    limit,
  );
  return NextResponse.json({ updates: feed.map(serializeFeedItem) });
}
