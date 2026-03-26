import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/intelligence/batches — list recent job runs with signal counts + previews
export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20")

  const batches = await prisma.signalBatch.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(limit, 50),
    include: {
      _count: { select: { signals: true } },
      signals: {
        select: {
          id: true,
          headline: true,
          tickers: true,
          urgency: true,
          sentiment: true,
          searchTool: true,
          searchQuery: true,
          searchContext: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  })

  return NextResponse.json(batches)
}
