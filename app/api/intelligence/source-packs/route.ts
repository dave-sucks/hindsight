import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

// GET /api/intelligence/source-packs — list packs with sources
export async function GET(req: NextRequest) {
  const analystId = req.nextUrl.searchParams.get("analystId")

  const packs = await prisma.sourcePack.findMany({
    where: {
      ...(analystId ? { analystId } : {}),
    },
    include: {
      sources: {
        include: { source: true },
        orderBy: { priority: "asc" },
      },
    },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  })

  return NextResponse.json(packs)
}

// POST /api/intelligence/source-packs — create a pack with sources
const createSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(["FIRM", "ANALYST"]),
  analystId: z.string().optional(),
  sourceIds: z.array(z.object({
    sourceId: z.string(),
    priority: z.number().int().min(1).max(5).default(3),
  })).default([]),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { name, scope, analystId, sourceIds } = parsed.data

  const pack = await prisma.sourcePack.create({
    data: {
      name,
      scope,
      analystId: analystId ?? null,
      sources: {
        create: sourceIds.map((s) => ({
          sourceId: s.sourceId,
          priority: s.priority,
        })),
      },
    },
    include: {
      sources: { include: { source: true } },
    },
  })

  return NextResponse.json(pack, { status: 201 })
}

// PATCH /api/intelligence/source-packs — update sources in a pack
const patchSchema = z.object({
  packId: z.string(),
  name: z.string().optional(),
  sourceIds: z.array(z.object({
    sourceId: z.string(),
    priority: z.number().int().min(1).max(5).default(3),
  })).optional(),
})

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { packId, name, sourceIds } = parsed.data

  // Update name if provided
  if (name) {
    await prisma.sourcePack.update({
      where: { id: packId },
      data: { name },
    })
  }

  // Replace sources if provided
  if (sourceIds) {
    await prisma.sourcePackSource.deleteMany({ where: { packId } })
    await prisma.sourcePackSource.createMany({
      data: sourceIds.map((s) => ({
        packId,
        sourceId: s.sourceId,
        priority: s.priority,
      })),
    })
  }

  const updated = await prisma.sourcePack.findUnique({
    where: { id: packId },
    include: {
      sources: { include: { source: true }, orderBy: { priority: "asc" } },
    },
  })

  return NextResponse.json(updated)
}

// DELETE /api/intelligence/source-packs
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  // Cascade deletes the source-pack links
  await prisma.sourcePackSource.deleteMany({ where: { packId: id } })
  await prisma.sourcePack.delete({ where: { id } })
  return NextResponse.json({ deleted: true })
}
