import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/intelligence/briefs — list morning briefs for a date (default: today)
// Query params:
//   date=YYYY-MM-DD — specific date
//   dates=true — return list of dates that have briefs (for date picker)
export async function GET(req: NextRequest) {
  // If ?dates=true, return available dates
  if (req.nextUrl.searchParams.get("dates") === "true") {
    const briefs = await prisma.morningBrief.findMany({
      select: { date: true },
      distinct: ["date"],
      orderBy: { date: "desc" },
      take: 30,
    })
    const dates = briefs.map((b) => b.date.toISOString().split("T")[0])
    return NextResponse.json(dates)
  }

  const dateParam = req.nextUrl.searchParams.get("date")
  const date = dateParam ? new Date(dateParam + "T00:00:00") : (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })()

  const briefs = await prisma.morningBrief.findMany({
    where: { date },
    include: {
      analyst: {
        select: { id: true, name: true },
      },
    },
    orderBy: { generatedAt: "desc" },
  })

  return NextResponse.json(briefs)
}
