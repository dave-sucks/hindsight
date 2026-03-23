import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

// GET /api/intelligence/queries — list all queries (optional scope/analyst filter)
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") // FIRM | ANALYST
  const analystId = req.nextUrl.searchParams.get("analystId")

  const queries = await prisma.intelligenceQuery.findMany({
    where: {
      ...(scope ? { scope } : {}),
      ...(analystId ? { analystId } : {}),
    },
    orderBy: [{ scope: "asc" }, { category: "asc" }, { createdAt: "asc" }],
  })

  return NextResponse.json(queries)
}

// POST /api/intelligence/queries — create a new query
const createSchema = z.object({
  query: z.string().min(5),
  category: z.enum(["MARKET", "SECTOR", "TICKER", "THEMATIC", "EVENT"]),
  scope: z.enum(["FIRM", "ANALYST"]),
  analystId: z.string().optional(),
  createdBy: z.enum(["USER", "BRIEFING_AGENT", "ANALYST_BUILDER", "ANALYST_RUNTIME"]).default("USER"),
  expiresAt: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { query, category, scope, analystId, createdBy, expiresAt } = parsed.data

  const created = await prisma.intelligenceQuery.create({
    data: {
      query,
      category,
      scope,
      analystId: analystId ?? null,
      createdBy,
      enabled: true,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  })

  return NextResponse.json(created, { status: 201 })
}

// PATCH /api/intelligence/queries — bulk toggle enabled/disabled
const bulkToggleSchema = z.object({
  ids: z.array(z.string()),
  enabled: z.boolean(),
})

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const parsed = bulkToggleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { ids, enabled } = parsed.data

  const result = await prisma.intelligenceQuery.updateMany({
    where: { id: { in: ids } },
    data: { enabled },
  })

  return NextResponse.json({ updated: result.count })
}

// DELETE /api/intelligence/queries — delete by id (query param)
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  await prisma.intelligenceQuery.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}
