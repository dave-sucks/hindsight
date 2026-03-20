import { prisma } from "@/lib/prisma"

async function backfillThesisStatus() {
  console.log("Starting thesis status backfill...")

  // 1. Theses linked to CLOSED positions → CLOSED
  const closedPositionTickers = await prisma.position.findMany({
    where: { status: "CLOSED" },
    select: { symbol: true, analystId: true, closedAt: true },
  })

  let closedCount = 0
  for (const pos of closedPositionTickers) {
    const result = await prisma.thesis.updateMany({
      where: {
        ticker: pos.symbol,
        direction: { not: "PASS" },
        status: "ACTIVE",
        researchRun: { agentConfigId: pos.analystId },
        createdAt: { lte: pos.closedAt ?? new Date() },
      },
      data: { status: "CLOSED" },
    })
    closedCount += result.count
  }
  console.log(`Marked ${closedCount} theses as CLOSED (linked to closed positions)`)

  // 2. Multiple ACTIVE theses on same ticker by same analyst → older ones SUPERSEDED
  const duplicates = await prisma.$queryRaw<
    Array<{ userId: string; ticker: string; cnt: bigint }>
  >`
    SELECT "userId", "ticker", COUNT(*) as cnt
    FROM "Thesis"
    WHERE "status" = 'ACTIVE' AND "direction" != 'PASS'
    GROUP BY "userId", "ticker"
    HAVING COUNT(*) > 1
  `

  let supersededCount = 0
  for (const dup of duplicates) {
    const theses = await prisma.thesis.findMany({
      where: {
        userId: dup.userId,
        ticker: dup.ticker,
        status: "ACTIVE",
        direction: { not: "PASS" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })

    if (theses.length > 1) {
      const olderIds = theses.slice(1).map((t) => t.id)
      const result = await prisma.thesis.updateMany({
        where: { id: { in: olderIds } },
        data: { status: "SUPERSEDED" },
      })
      supersededCount += result.count
    }
  }
  console.log(
    `Marked ${supersededCount} theses as SUPERSEDED (older duplicates)`
  )

  // 3. PASS theses where a newer non-PASS thesis exists for same ticker → SUPERSEDED
  const passTheses = await prisma.thesis.findMany({
    where: { direction: "PASS", status: "ACTIVE" },
    select: { id: true, userId: true, ticker: true, createdAt: true },
  })

  let passSupersededCount = 0
  for (const pass of passTheses) {
    const newerNonPass = await prisma.thesis.findFirst({
      where: {
        userId: pass.userId,
        ticker: pass.ticker,
        direction: { not: "PASS" },
        createdAt: { gt: pass.createdAt },
      },
    })
    if (newerNonPass) {
      await prisma.thesis.update({
        where: { id: pass.id },
        data: { status: "SUPERSEDED" },
      })
      passSupersededCount++
    }
  }
  console.log(
    `Marked ${passSupersededCount} PASS theses as SUPERSEDED (newer thesis exists)`
  )

  console.log("Backfill complete!")
}

backfillThesisStatus()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err)
    process.exit(1)
  })
