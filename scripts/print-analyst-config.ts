/**
 * print-analyst-config.ts
 *
 * Pre-flight inspection for the manual discovery trigger. Prints the
 * Universe + feeds + edge fields the discovery prompt will render, so
 * you can predict what Step 1 will actually call before firing the run.
 *
 * Run with:
 *   npx tsx scripts/print-analyst-config.ts <agentConfigId>
 *
 * Or with the default (Tech Momentum):
 *   npx tsx scripts/print-analyst-config.ts
 *
 * Useful for: "I'm about to fire app/discovery.run.manual — what will
 * the agent see?" Especially the `feeds` field, since the new Step 1
 * only calls get_market_movers / get_earnings_calendar when the analyst
 * is subscribed to the matching feed (PR #326).
 */

import { prisma } from "@/lib/prisma";

// Default to Tech Momentum (same default as trigger-discovery-manual.ts).
const DEFAULT_AGENT_CONFIG_ID = "cmmofy6t3000004l7858o1xma";

function fmtList(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "(empty)";
  return arr.join(", ");
}

function fmtCap(n: bigint | number | null): string {
  if (n == null) return "no bound";
  const num = typeof n === "bigint" ? Number(n) : n;
  return `$${(num / 1_000_000_000).toFixed(1)}B`;
}

async function main() {
  const agentConfigId = process.argv[2] ?? DEFAULT_AGENT_CONFIG_ID;
  const config = await prisma.agentConfig.findUnique({
    where: { id: agentConfigId },
    select: {
      id: true,
      name: true,
      enabled: true,
      directionBias: true,
      holdDurations: true,
      sectors: true,
      industries: true,
      themes: true,
      feeds: true,
      signalTypes: true,
      marketCapMin: true,
      marketCapMax: true,
      exclusionList: true,
      minConfidence: true,
      maxOpenPositions: true,
      maxPositionSize: true,
    },
  });

  if (!config) {
    console.error(`No AgentConfig found with id=${agentConfigId}.`);
    process.exit(1);
  }

  // Predict which Step-1 surfaces the discovery prompt will tell the
  // agent to call, given this analyst's feeds. Mirrors the gating
  // logic in lib/agent/system-prompts/discovery.ts.
  const feedSet = new Set((config.feeds ?? []).map((f) => f.toUpperCase()));
  const willCallMovers =
    feedSet.has("MARKET_MOVERS_GAINERS") ||
    feedSet.has("MARKET_MOVERS_LOSERS") ||
    feedSet.has("MARKET_MOVERS_ACTIVES");
  const willCallEarnings = feedSet.has("EARNINGS_CALENDAR");

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`Analyst: ${config.name}`);
  console.log(`  id:      ${config.id}`);
  console.log(`  enabled: ${config.enabled}`);
  console.log("═══════════════════════════════════════════════════");
  console.log("\nUNIVERSE");
  console.log(`  sectors:        ${fmtList(config.sectors)}`);
  console.log(`  industries:     ${fmtList(config.industries)}`);
  console.log(`  themes:         ${fmtList(config.themes)}`);
  console.log(`  market cap:     ${fmtCap(config.marketCapMin)} – ${fmtCap(config.marketCapMax)}`);
  console.log(`  exclusions:     ${fmtList(config.exclusionList)}`);
  console.log("\nFEEDS (firm-aggregate subscriptions)");
  console.log(`  feeds:          ${fmtList(config.feeds)}`);
  console.log("\nEDGE");
  console.log(`  direction bias: ${config.directionBias ?? "BOTH"}`);
  console.log(`  hold duration:  ${fmtList(config.holdDurations)}`);
  console.log(`  signal types:   ${fmtList(config.signalTypes)}`);
  console.log(`  min confidence: ${config.minConfidence ?? 70}%`);
  console.log(`  max positions:  ${config.maxOpenPositions ?? 5} slots`);
  console.log(`  max pos size:   $${config.maxPositionSize ?? 500}`);

  console.log("\n═══════════════════════════════════════════════════");
  console.log("PREDICTED STEP-1 TOOL CALLS for next discovery run");
  console.log("═══════════════════════════════════════════════════");
  console.log("  read_signals             : ALWAYS (universal push)");
  console.log(
    `  get_market_movers        : ${willCallMovers ? "YES (subscribed)" : "NO  (not subscribed)"}`,
  );
  console.log(
    `  get_earnings_calendar    : ${willCallEarnings ? "YES (subscribed)" : "NO  (not subscribed)"}`,
  );

  if (!willCallMovers && !willCallEarnings) {
    console.log(
      "\n⚠  This analyst's only Step-1 surface is read_signals.",
    );
    console.log(
      "   If the routed-signal inbox is sparse this week, the run",
    );
    console.log(
      "   will land HOLD with 0 dispatches and 0 PASS rows. That's",
    );
    console.log(
      "   the intended behavior per the feeds-gating change — but",
    );
    console.log(
      "   adjust the analyst's feeds field if you want a richer pool.",
    );
  }
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[print-analyst-config] failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
