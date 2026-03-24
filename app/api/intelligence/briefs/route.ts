import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/intelligence/briefs — list morning briefs for today (or a given date)
export async function GET(req: NextRequest) {
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
