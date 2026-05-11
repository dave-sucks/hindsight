import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"
import { etTradingDayDate } from "@/lib/market-hours"
import { getAccountId } from "@/lib/auth/account"

// GET /api/intelligence/briefs — list morning briefs scoped to current account
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const accountId = await getAccountId(user.id)
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 })

  // Get this account's analyst IDs
  const userAnalysts = await prisma.agentConfig.findMany({
    where: { accountId },
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
  // ET trading-day date — matches how the morning cron writes MorningBrief.date
  const date = dateParam ? new Date(dateParam + "T00:00:00.000Z") : etTradingDayDate()

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
