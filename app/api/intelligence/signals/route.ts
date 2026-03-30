import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"

// GET /api/intelligence/signals — list recent signals/findings scoped to current user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Get this user's analyst IDs
  const userAnalysts = await prisma.agentConfig.findMany({
    where: { userId: user.id },
    select: { id: true },
  })
  const analystIds = userAnalysts.map((a) => a.id)

  const ticker = req.nextUrl.searchParams.get("ticker")
  const type = req.nextUrl.searchParams.get("type")
  const urgency = req.nextUrl.searchParams.get("urgency")
  const batchId = req.nextUrl.searchParams.get("batchId")
  const analystId = req.nextUrl.searchParams.get("analystId")
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50")

  const signals = await prisma.signal.findMany({
    where: {
      ...(ticker ? { tickers: { has: ticker } } : {}),
      ...(type ? { type } : {}),
      ...(urgency ? { urgency } : {}),
      ...(batchId ? { batchId } : {}),
      ...(analystId ? { routes: { some: { analystId } } } : {}),
      // Scope to user: only signals routed to their analysts
      routes: { some: { analystId: { in: analystIds } } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      batchId: true,
      artifactId: true,
      monitorId: true,
      type: true,
      headline: true,
      summary: true,
      evidence: true,
      tickers: true,
      themes: true,
      sectors: true,
      sentiment: true,
      noveltyScore: true,
      urgency: true,
      sourceQuality: true,
      freshness: true,
      sourceUrls: true,
      sourceNames: true,
      searchTool: true,
      searchQuery: true,
      searchContext: true,
      aggregateType: true,
      dataPayload: true,
      itemCount: true,
      expiresAt: true,
      createdAt: true,
      batch: {
        select: { jobType: true, status: true, startedAt: true },
      },
      monitor: {
        select: { id: true, name: true, type: true, method: true, config: true },
      },
      routes: {
        select: {
          id: true,
          analystId: true,
          analyst: { select: { id: true, name: true } },
          relevanceScore: true,
          routeReason: true,
          status: true,
        },
      },
    },
  })

  return NextResponse.json(signals)
}
