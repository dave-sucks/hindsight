import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"

// GET /api/intelligence/briefs — list morning briefs scoped to current user
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

  // If ?dates=true, return available dates for this user's analysts
  if (req.nextUrl.searchParams.get("dates") === "true") {
    const briefs = await prisma.morningBrief.findMany({
      where: { analystId: { in: analystIds } },
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
    where: {
      date,
      analystId: { in: analystIds },
    },
    include: {
      analyst: {
        select: { id: true, name: true },
      },
    },
    orderBy: { generatedAt: "desc" },
  })

  return NextResponse.json(briefs)
}
