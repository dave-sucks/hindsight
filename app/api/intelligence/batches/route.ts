import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"
import { getAccountId } from "@/lib/auth/account"

// GET /api/intelligence/batches — list recent job runs with signal counts.
// Batches are firm-wide job records (no account column), so this checks
// sign-in and an account, like the other /api/intelligence routes.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const accountId = await getAccountId(user.id)
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 })

  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20")

  const batches = await prisma.signalBatch.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(limit, 50),
    include: {
      _count: { select: { signals: true } },
    },
  })

  return NextResponse.json(batches)
}
