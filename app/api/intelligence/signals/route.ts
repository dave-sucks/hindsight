import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/intelligence/signals — list recent signals with optional filters
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
    include: {
      batch: {
        select: { jobType: true, status: true, startedAt: true },
      },
    },
  })

  return NextResponse.json(signals)
}
