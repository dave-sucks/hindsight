import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

// GET /api/intelligence/sources — list all sources
export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category")

  const sources = await prisma.source.findMany({
    where: {
      ...(category ? { category } : {}),
    },
    orderBy: [{ qualityScore: "desc" }, { name: "asc" }],
  })

  return NextResponse.json(sources)
}

// POST /api/intelligence/sources — create a new source
const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["DOMAIN", "RSS", "NEWSLETTER", "TWITTER", "API"]),
  url: z.string().url().optional(),
  domain: z.string().optional(),
  category: z.enum(["MARKET", "SECTOR", "COMPANY", "THEMATIC", "SOCIAL", "EVENT"]),
  qualityScore: z.number().int().min(1).max(5).default(3),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const created = await prisma.source.create({
    data: {
      ...parsed.data,
      enabled: true,
    },
  })

  return NextResponse.json(created, { status: 201 })
}

// PATCH /api/intelligence/sources — toggle enabled or update quality score
const patchSchema = z.object({
  id: z.string(),
  enabled: z.boolean().optional(),
  qualityScore: z.number().int().min(1).max(5).optional(),
})

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { id, ...data } = parsed.data

  const updated = await prisma.source.update({
    where: { id },
    data,
  })

  return NextResponse.json(updated)
}

// DELETE /api/intelligence/sources
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  await prisma.source.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}
