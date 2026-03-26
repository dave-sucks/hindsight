import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/intelligence/signals — list recent signals/findings with optional filters
export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")
  const type = req.nextUrl.searchParams.get("type")
  const urgency = req.nextUrl.searchParams.get("urgency")
  const batchId = req.nextUrl.searchParams.get("batchId")
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50")

  const signals = await prisma.signal.findMany({
    where: {
      ...(ticker ? { tickers: { has: ticker } } : {}),
      ...(type ? { type } : {}),
      ...(urgency ? { urgency } : {}),
      ...(batchId ? { batchId } : {}),
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
