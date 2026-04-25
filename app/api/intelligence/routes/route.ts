import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { etTradingDayDate } from "@/lib/market-hours"

// GET /api/intelligence/routes — analyst signal route summary
//
// Default scope is today's trading day. Pass ?all=1 for the full-history view
// (operator/debug only). Pass ?lookbackDays=N for an N-day window.
export async function GET(req: NextRequest) {
  const allTime = req.nextUrl.searchParams.get("all") === "1"
  const lookbackDays = Math.max(
    0,
    Math.min(30, parseInt(req.nextUrl.searchParams.get("lookbackDays") ?? "0") || 0),
  )

  let timeWhere: Record<string, unknown> = {}
  if (!allTime) {
    const today = etTradingDayDate()
    const windowStart = new Date(today)
    windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)
    timeWhere = {
      OR: [
        { tradingDay: { gte: windowStart, lte: today } },
        { tradingDay: null, routedAt: { gte: windowStart } },
      ],
    }
  }

  const analysts = await prisma.agentConfig.findMany({
    where: { enabled: true },
    select: { id: true, name: true },
  })

  const result = await Promise.all(
    analysts.map(async (analyst) => {
      const where = { analystId: analyst.id, ...timeWhere }
      const [routes, totalRoutes] = await Promise.all([
        prisma.analystSignalRoute.findMany({
          where,
          select: { relevanceScore: true, status: true },
          orderBy: { routedAt: "desc" },
          take: 200,
        }),
        prisma.analystSignalRoute.count({ where }),
      ])

      const high = routes.filter((r) => r.relevanceScore >= 60).length
      const medium = routes.filter((r) => r.relevanceScore >= 30 && r.relevanceScore < 60).length
      const low = routes.filter((r) => r.relevanceScore < 30).length
      const pending = routes.filter((r) => r.status === "PENDING").length
      const read = routes.filter((r) => r.status === "READ").length

      return {
        analystId: analyst.id,
        analystName: analyst.name,
        totalRoutes,
        high,
        medium,
        low,
        pending,
        read,
      }
    })
  )

  return NextResponse.json(result)
}
