/**
 * Seed the V3 intelligence layer: sources, source packs, and default queries.
 *
 * Run: npx tsx scripts/seed-intelligence.ts
 *
 * Idempotent — uses upsert on source name + pack name. Safe to re-run.
 */
import { prisma } from "@/lib/prisma"
import type {
  SourceSeed,
  SourcePackSeed,
  IntelligenceQuerySeed,
} from "@/lib/intelligence/types"

// ── Source Definitions ──────────────────────────────────────────────────────

const SOURCES: SourceSeed[] = [
  // Broad market / news
  { name: "Reuters", type: "DOMAIN", domain: "reuters.com", category: "MARKET", qualityScore: 5 },
  { name: "Bloomberg", type: "DOMAIN", domain: "bloomberg.com", category: "MARKET", qualityScore: 5 },
  { name: "CNBC", type: "DOMAIN", domain: "cnbc.com", category: "MARKET", qualityScore: 4 },
  { name: "MarketWatch", type: "DOMAIN", domain: "marketwatch.com", category: "MARKET", qualityScore: 4 },
  { name: "Wall Street Journal", type: "DOMAIN", domain: "wsj.com", category: "MARKET", qualityScore: 5 },
  { name: "Yahoo Finance", type: "DOMAIN", domain: "finance.yahoo.com", category: "MARKET", qualityScore: 3 },
  { name: "Financial Times", type: "DOMAIN", domain: "ft.com", category: "MARKET", qualityScore: 5 },

  // Macro / economic
  { name: "Federal Reserve", type: "DOMAIN", domain: "federalreserve.gov", category: "EVENT", qualityScore: 5 },
  { name: "US Treasury", type: "DOMAIN", domain: "treasury.gov", category: "EVENT", qualityScore: 5 },

  // Tech / catalysts
  { name: "TechCrunch", type: "DOMAIN", domain: "techcrunch.com", category: "SECTOR", qualityScore: 4 },
  { name: "The Verge", type: "DOMAIN", domain: "theverge.com", category: "SECTOR", qualityScore: 3 },
  { name: "Benzinga", type: "DOMAIN", domain: "benzinga.com", category: "MARKET", qualityScore: 3 },
  { name: "Investor's Business Daily", type: "DOMAIN", domain: "investors.com", category: "MARKET", qualityScore: 4 },

  // Earnings / fundamentals
  { name: "Seeking Alpha", type: "DOMAIN", domain: "seekingalpha.com", category: "COMPANY", qualityScore: 4 },
  { name: "Earnings Whispers", type: "DOMAIN", domain: "earningswhispers.com", category: "EVENT", qualityScore: 3 },

  // Healthcare / biotech
  { name: "STAT News", type: "DOMAIN", domain: "statnews.com", category: "SECTOR", qualityScore: 5 },
  { name: "BioPharma Dive", type: "DOMAIN", domain: "biopharmadive.com", category: "SECTOR", qualityScore: 4 },

  // Financials
  { name: "American Banker", type: "DOMAIN", domain: "americanbanker.com", category: "SECTOR", qualityScore: 4 },

  // Options / flow
  { name: "Unusual Whales", type: "DOMAIN", domain: "unusualwhales.com", category: "SOCIAL", qualityScore: 3 },
  { name: "Barchart", type: "DOMAIN", domain: "barchart.com", category: "MARKET", qualityScore: 3 },

  // Regulatory / filings
  { name: "SEC EDGAR", type: "API", url: "https://efts.sec.gov", domain: "sec.gov", category: "EVENT", qualityScore: 5 },
  { name: "FDA", type: "DOMAIN", domain: "fda.gov", category: "EVENT", qualityScore: 5 },
]

// ── Source Pack Definitions ─────────────────────────────────────────────────

const SOURCE_PACKS: SourcePackSeed[] = [
  {
    name: "Firm Market Pack",
    scope: "FIRM",
    sources: [
      { name: "Reuters", priority: 1 },
      { name: "Bloomberg", priority: 1 },
      { name: "CNBC", priority: 2 },
      { name: "MarketWatch", priority: 2 },
      { name: "Wall Street Journal", priority: 1 },
      { name: "Yahoo Finance", priority: 3 },
      { name: "Financial Times", priority: 2 },
      { name: "Federal Reserve", priority: 1 },
      { name: "US Treasury", priority: 2 },
      { name: "Benzinga", priority: 3 },
      { name: "SEC EDGAR", priority: 1 },
      { name: "FDA", priority: 2 },
    ],
  },
  {
    name: "Trend Chaser Pack",
    scope: "ANALYST",
    sources: [
      { name: "TechCrunch", priority: 1 },
      { name: "The Verge", priority: 2 },
      { name: "Investor's Business Daily", priority: 1 },
      { name: "Benzinga", priority: 2 },
      { name: "Unusual Whales", priority: 2 },
      { name: "Barchart", priority: 3 },
    ],
  },
  {
    name: "Earnings Play Pack",
    scope: "ANALYST",
    sources: [
      { name: "Seeking Alpha", priority: 1 },
      { name: "Earnings Whispers", priority: 1 },
      { name: "STAT News", priority: 2 },
      { name: "BioPharma Dive", priority: 2 },
      { name: "American Banker", priority: 2 },
    ],
  },
]

// ── Default Intelligence Queries ────────────────────────────────────────────

const DEFAULT_QUERIES: IntelligenceQuerySeed[] = [
  // Firm-wide market sweep queries
  { query: "US stock market overnight developments and pre-market movers today", category: "MARKET", scope: "FIRM" },
  { query: "Federal Reserve monetary policy news and interest rate expectations today", category: "MARKET", scope: "FIRM" },
  { query: "S&P 500 sector rotation trends and leadership changes this week", category: "SECTOR", scope: "FIRM" },
  { query: "Major earnings reports and results this week surprises and guidance", category: "EVENT", scope: "FIRM" },
  { query: "FDA drug approvals decisions and regulatory actions this week", category: "EVENT", scope: "FIRM" },
  { query: "Unusual options activity and large institutional block trades today", category: "MARKET", scope: "FIRM" },
  { query: "Geopolitical events trade policy and tariff developments affecting markets today", category: "MARKET", scope: "FIRM" },
  { query: "IPO market activity new listings and upcoming offerings this week", category: "EVENT", scope: "FIRM" },
  { query: "Technology sector AI and semiconductor industry developments today", category: "SECTOR", scope: "FIRM" },
  { query: "Energy oil prices and commodities market movements today", category: "SECTOR", scope: "FIRM" },
  { query: "Major mergers acquisitions and corporate deals announced today", category: "EVENT", scope: "FIRM" },
  { query: "US economic data releases jobs inflation GDP consumer spending this week", category: "MARKET", scope: "FIRM" },
]

// ── Seed Logic ──────────────────────────────────────────────────────────────

async function seedSources(): Promise<Map<string, string>> {
  const sourceMap = new Map<string, string>()

  for (const src of SOURCES) {
    const result = await prisma.source.upsert({
      where: { id: `seed-${src.name.toLowerCase().replace(/\s+/g, "-")}` },
      create: {
        id: `seed-${src.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: src.name,
        type: src.type,
        url: src.url,
        domain: src.domain,
        category: src.category,
        qualityScore: src.qualityScore,
        enabled: true,
      },
      update: {
        name: src.name,
        type: src.type,
        url: src.url,
        domain: src.domain,
        category: src.category,
        qualityScore: src.qualityScore,
      },
    })
    sourceMap.set(src.name, result.id)
  }

  console.log(`Seeded ${sourceMap.size} sources`)
  return sourceMap
}

async function seedSourcePacks(sourceMap: Map<string, string>) {
  // Look up analysts by name to link analyst-specific packs
  const analysts = await prisma.agentConfig.findMany({
    select: { id: true, name: true },
  })
  const analystByName = new Map(analysts.map((a) => [a.name, a.id]))

  for (const pack of SOURCE_PACKS) {
    const packId = `seed-${pack.name.toLowerCase().replace(/\s+/g, "-")}`

    // Determine analyst ID for analyst-scoped packs
    let analystId: string | null = null
    if (pack.scope === "ANALYST") {
      // Match pack name to analyst: "Trend Chaser Pack" → "Trend Chaser"
      const analystName = pack.name.replace(" Pack", "")
      analystId = analystByName.get(analystName) ?? null
      if (!analystId) {
        console.log(`  Warning: No analyst found for pack "${pack.name}" (looked for "${analystName}")`)
      }
    }

    // Upsert the pack
    await prisma.sourcePack.upsert({
      where: { id: packId },
      create: {
        id: packId,
        name: pack.name,
        scope: pack.scope,
        analystId,
      },
      update: {
        name: pack.name,
        scope: pack.scope,
        analystId,
      },
    })

    // Clear existing pack sources and re-create
    await prisma.sourcePackSource.deleteMany({ where: { packId } })

    for (const src of pack.sources) {
      const sourceId = sourceMap.get(src.name)
      if (!sourceId) {
        console.log(`  Warning: Source "${src.name}" not found for pack "${pack.name}"`)
        continue
      }
      await prisma.sourcePackSource.create({
        data: {
          packId,
          sourceId,
          priority: src.priority,
        },
      })
    }

    console.log(`Seeded pack "${pack.name}" with ${pack.sources.length} sources${analystId ? ` (analyst: ${analystId})` : ""}`)
  }
}

async function seedQueries() {
  let created = 0
  for (const q of DEFAULT_QUERIES) {
    const id = `seed-query-${q.query.slice(0, 40).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`

    await prisma.intelligenceQuery.upsert({
      where: { id },
      create: {
        id,
        scope: q.scope,
        query: q.query,
        category: q.category,
        enabled: true,
        createdBy: "USER",
      },
      update: {
        query: q.query,
        category: q.category,
        scope: q.scope,
      },
    })
    created++
  }

  console.log(`Seeded ${created} intelligence queries`)
}

async function main() {
  console.log("Seeding V3 intelligence layer...\n")

  const sourceMap = await seedSources()
  await seedSourcePacks(sourceMap)
  await seedQueries()

  // Summary
  const counts = await Promise.all([
    prisma.source.count(),
    prisma.sourcePack.count(),
    prisma.sourcePackSource.count(),
    prisma.intelligenceQuery.count(),
  ])

  console.log(`\nDone. DB now has:`)
  console.log(`  ${counts[0]} sources`)
  console.log(`  ${counts[1]} source packs`)
  console.log(`  ${counts[2]} source-pack links`)
  console.log(`  ${counts[3]} intelligence queries`)
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
