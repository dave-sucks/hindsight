/**
 * Backfill V3 intelligence infrastructure for existing analysts.
 *
 * For each analyst missing Monitors or IntelligencePolicy:
 *   1. Creates DOMAIN monitors based on sectors/signals
 *   2. Creates SEARCH monitors from watchlist/sectors/signals
 *   3. Sets a default IntelligencePolicy on the AgentConfig
 *
 * Usage:
 *   npx tsx scripts/backfill-v3-infra.ts              # dry-run (default)
 *   npx tsx scripts/backfill-v3-infra.ts --execute     # actually write to DB
 *   npx tsx scripts/backfill-v3-infra.ts --validate    # post-run validation
 */
import { prisma } from "@/lib/prisma";
import { DEFAULT_INTELLIGENCE_POLICY } from "@/lib/intelligence/types";
import type { SourceCategory, QueryCategory } from "@/lib/intelligence/types";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--execute");
const VALIDATE_ONLY = args.includes("--validate");

// ── Sector → Domain Source Mapping ──────────────────────────────────────────

const SECTOR_SOURCES: Record<string, Array<{ name: string; domain: string; category: SourceCategory; qualityScore: number }>> = {
  Technology: [
    { name: "TechCrunch", domain: "techcrunch.com", category: "SECTOR", qualityScore: 4 },
    { name: "The Verge", domain: "theverge.com", category: "SECTOR", qualityScore: 3 },
    { name: "Ars Technica", domain: "arstechnica.com", category: "SECTOR", qualityScore: 4 },
  ],
  Healthcare: [
    { name: "STAT News", domain: "statnews.com", category: "SECTOR", qualityScore: 5 },
    { name: "BioPharma Dive", domain: "biopharmadive.com", category: "SECTOR", qualityScore: 4 },
    { name: "FDA", domain: "fda.gov", category: "EVENT", qualityScore: 5 },
  ],
  Biotech: [
    { name: "STAT News", domain: "statnews.com", category: "SECTOR", qualityScore: 5 },
    { name: "BioPharma Dive", domain: "biopharmadive.com", category: "SECTOR", qualityScore: 4 },
    { name: "FDA", domain: "fda.gov", category: "EVENT", qualityScore: 5 },
  ],
  Financials: [
    { name: "American Banker", domain: "americanbanker.com", category: "SECTOR", qualityScore: 4 },
    { name: "Financial Times", domain: "ft.com", category: "MARKET", qualityScore: 5 },
  ],
  Energy: [
    { name: "Rigzone", domain: "rigzone.com", category: "SECTOR", qualityScore: 3 },
    { name: "OilPrice", domain: "oilprice.com", category: "SECTOR", qualityScore: 3 },
  ],
  "Consumer Discretionary": [
    { name: "Retail Dive", domain: "retaildive.com", category: "SECTOR", qualityScore: 4 },
  ],
  "Consumer Staples": [
    { name: "Food Dive", domain: "fooddive.com", category: "SECTOR", qualityScore: 3 },
  ],
  Industrials: [
    { name: "Investor's Business Daily", domain: "investors.com", category: "MARKET", qualityScore: 4 },
  ],
  "Real Estate": [
    { name: "GlobeSt", domain: "globest.com", category: "SECTOR", qualityScore: 3 },
  ],
};

// Baseline domain sources every analyst gets
const BASELINE_SOURCES = [
  { name: "Reuters", domain: "reuters.com", category: "MARKET" as SourceCategory, qualityScore: 5 },
  { name: "CNBC", domain: "cnbc.com", category: "MARKET" as SourceCategory, qualityScore: 4 },
  { name: "SEC EDGAR", domain: "sec.gov", category: "EVENT" as SourceCategory, qualityScore: 5 },
  { name: "Seeking Alpha", domain: "seekingalpha.com", category: "COMPANY" as SourceCategory, qualityScore: 4 },
];

// ── Search Query Generation ─────────────────────────────────────────────────

function generateSearchQueries(analyst: {
  watchlist: string[];
  sectors: string[];
  signalTypes: string[];
  analystPrompt: string | null;
}): Array<{ query: string; category: QueryCategory }> {
  const queries: Array<{ query: string; category: QueryCategory }> = [];

  // Watchlist ticker queries
  for (const ticker of analyst.watchlist.slice(0, 10)) {
    queries.push({
      query: `${ticker} earnings catalysts price action news analysis`,
      category: "TICKER",
    });
  }

  // Sector queries
  for (const sector of analyst.sectors) {
    queries.push({
      query: `${sector} sector industry news developments trends today`,
      category: "SECTOR",
    });
  }

  // Signal type queries
  const signalQueryMap: Record<string, string> = {
    EARNINGS: "Upcoming earnings surprises beats misses guidance revisions",
    TECHNICAL: "Technical breakouts momentum RSI crossover setups stocks",
    OPTIONS: "Unusual options flow activity large block trades sweeps",
    CATALYST: "Corporate catalysts product launches FDA approvals M&A rumors",
    MACRO: "Federal Reserve economic data inflation employment GDP impact on stocks",
    MOMENTUM: "Stocks with unusual volume momentum breakout relative strength",
    VALUE: "Undervalued stocks deep value opportunities margin of safety",
    GROWTH: "High growth stocks revenue acceleration market expansion",
  };

  for (const signal of analyst.signalTypes) {
    const q = signalQueryMap[signal];
    if (q) {
      queries.push({ query: q, category: "THEMATIC" });
    }
  }

  // General discovery query from analyst prompt
  if (analyst.analystPrompt) {
    const prompt = analyst.analystPrompt.slice(0, 200);
    queries.push({
      query: `Stock market opportunities matching strategy: ${prompt}`,
      category: "THEMATIC",
    });
  }

  return queries;
}

// ── Domain Monitor Generation ───────────────────────────────────────────────

function generateDomainSources(analyst: {
  name: string;
  sectors: string[];
}): Array<{ name: string; domain: string; category: SourceCategory; qualityScore: number }> {
  const sources = [...BASELINE_SOURCES];
  const seenDomains = new Set(sources.map((s) => s.domain));

  for (const sector of analyst.sectors) {
    const sectorSources = SECTOR_SOURCES[sector] ?? [];
    for (const src of sectorSources) {
      if (!seenDomains.has(src.domain)) {
        sources.push(src);
        seenDomains.add(src.domain);
      }
    }
  }

  return sources;
}

// ── Validation ──────────────────────────────────────────────────────────────

async function validate() {
  const analysts = await prisma.agentConfig.findMany({
    select: {
      id: true,
      name: true,
      intelligencePolicy: true,
      monitors: {
        select: { id: true, type: true },
      },
    },
  });

  console.log(`\n=== Validation Report ===\n`);
  let allGood = true;

  for (const a of analysts) {
    const hasPolicy = a.intelligencePolicy != null;
    const domainMonitors = a.monitors.filter((m) => m.type === "DOMAIN").length;
    const searchMonitors = a.monitors.filter((m) => m.type === "SEARCH").length;
    const hasMonitors = a.monitors.length > 0;

    const status = hasPolicy && hasMonitors ? "OK" : "MISSING";
    if (status === "MISSING") allGood = false;

    console.log(`${status === "OK" ? "✓" : "✗"} ${a.name} (${a.id.slice(0, 8)})`);
    console.log(`  Policy: ${hasPolicy ? "yes" : "NO"}  |  Domain monitors: ${domainMonitors}  |  Search monitors: ${searchMonitors}`);
  }

  console.log(`\n${allGood ? "All analysts have V3 infrastructure." : "Some analysts are missing V3 infrastructure. Run with --execute."}`);
}

// ── Main Backfill ───────────────────────────────────────────────────────────

async function backfill() {
  console.log(`\n=== V3 Infrastructure Backfill ${DRY_RUN ? "(DRY RUN)" : "(EXECUTING)"} ===\n`);

  // Find analysts and their current monitor state
  const analysts = await prisma.agentConfig.findMany({
    select: {
      id: true,
      name: true,
      sectors: true,
      signalTypes: true,
      watchlist: true,
      analystPrompt: true,
      intelligencePolicy: true,
      monitors: {
        select: { id: true, type: true, name: true },
      },
    },
  });

  console.log(`Found ${analysts.length} total analysts\n`);

  let backfilled = 0;

  for (const analyst of analysts) {
    const needsPolicy = analyst.intelligencePolicy == null;
    const hasDomainMonitors = analyst.monitors.some((m) => m.type === "DOMAIN");
    const hasSearchMonitors = analyst.monitors.some((m) => m.type === "SEARCH");
    const needsDomainMonitors = !hasDomainMonitors;
    const needsSearchMonitors = !hasSearchMonitors;

    if (!needsPolicy && !needsDomainMonitors && !needsSearchMonitors) {
      console.log(`[SKIP] ${analyst.name} — already has V3 infra`);
      continue;
    }

    console.log(`\n[BACKFILL] ${analyst.name} (${analyst.id.slice(0, 8)})`);
    console.log(`  Needs: ${[needsPolicy && "policy", needsDomainMonitors && "domain monitors", needsSearchMonitors && "search monitors"].filter(Boolean).join(", ")}`);

    // Generate DOMAIN monitors
    if (needsDomainMonitors) {
      const sources = generateDomainSources(analyst);
      console.log(`  Domain monitors: ${sources.length} sources`);
      for (const src of sources) {
        console.log(`    - ${src.name} (${src.domain}) [${src.category}] quality=${src.qualityScore}`);
      }

      if (!DRY_RUN) {
        for (const src of sources) {
          await prisma.monitor.create({
            data: {
              name: src.name,
              type: "DOMAIN",
              method: "perplexity_sonar",
              config: {
                domain: src.domain,
                url: `https://${src.domain}`,
                qualityScore: src.qualityScore,
              },
              scope: "ANALYST",
              analystId: analyst.id,
              enabled: true,
              builtIn: false,
              origin: "USER",
              category: src.category,
            },
          });
        }
      }
    }

    // Generate SEARCH monitors (replaces IntelligenceQuery)
    if (needsSearchMonitors) {
      const queries = generateSearchQueries(analyst);
      console.log(`  Search monitors: ${queries.length} queries`);
      for (const q of queries) {
        console.log(`    - [${q.category}] ${q.query.slice(0, 80)}`);
      }

      if (!DRY_RUN) {
        for (const q of queries) {
          await prisma.monitor.create({
            data: {
              name: q.query,
              type: "SEARCH",
              method: "perplexity_sonar",
              config: { query: q.query },
              scope: "ANALYST",
              analystId: analyst.id,
              enabled: true,
              builtIn: false,
              origin: "USER",
              category: q.category,
            },
          });
        }
      }
    }

    // Set default intelligence policy
    if (needsPolicy) {
      console.log(`  Policy: default (holdings=40%, watchlist=35%, discovery=25%)`);

      if (!DRY_RUN) {
        await prisma.agentConfig.update({
          where: { id: analyst.id },
          data: {
            intelligencePolicy: DEFAULT_INTELLIGENCE_POLICY as unknown as object,
          },
        });
      }
    }

    backfilled++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Backfilled: ${backfilled}/${analysts.length} analysts`);
  if (DRY_RUN) {
    console.log(`\nThis was a DRY RUN. Run with --execute to apply changes.`);
  }
}

// ── Resync Check ────────────────────────────────────────────────────────────

async function resyncCheck() {
  console.log(`\n=== Resync Check: Monitor Duplicates ===\n`);

  const analysts = await prisma.agentConfig.findMany({
    select: {
      id: true,
      name: true,
      monitors: {
        select: { type: true, name: true, config: true },
      },
    },
  });

  for (const analyst of analysts) {
    // Check for duplicate domain monitors
    const domainMonitors = analyst.monitors.filter((m) => m.type === "DOMAIN");
    const domains = domainMonitors.map((m) => {
      const cfg = m.config as Record<string, unknown> | null;
      return cfg?.domain as string ?? m.name;
    });
    const dupes = domains.filter((d, i) => domains.indexOf(d) !== i);
    if (dupes.length > 0) {
      console.log(`  WARNING: Duplicate domain monitors for "${analyst.name}": ${dupes.join(", ")}`);
    }

    // Check for duplicate search monitors
    const searchMonitors = analyst.monitors.filter((m) => m.type === "SEARCH");
    const queries = searchMonitors.map((m) => {
      const cfg = m.config as Record<string, unknown> | null;
      return cfg?.query as string ?? m.name;
    });
    const queryDupes = queries.filter((q, i) => queries.indexOf(q) !== i);
    if (queryDupes.length > 0) {
      console.log(`  WARNING: Duplicate search monitors for "${analyst.name}": ${queryDupes.slice(0, 3).join(", ")}...`);
    }
  }

  // Check built-in monitors exist
  const builtIns = await prisma.monitor.findMany({
    where: { builtIn: true },
    select: { name: true, type: true },
  });
  console.log(`\nBuilt-in monitors: ${builtIns.length}`);
  for (const m of builtIns) {
    console.log(`  - ${m.name} (${m.type})`);
  }

  console.log(`\nResync check complete.`);
}

// ── Entry Point ─────────────────────────────────────────────────────────────

async function main() {
  if (VALIDATE_ONLY) {
    await validate();
  } else {
    await backfill();
    if (!DRY_RUN) {
      await validate();
      await resyncCheck();
    }
  }
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
