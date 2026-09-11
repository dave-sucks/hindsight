/**
 * print-analyst-config.ts
 *
 * Pre-flight inspection for the manual discovery trigger. Prints the
 * Universe + edge fields the discovery prompt will render.
 *
 * Run with:
 *   npx tsx scripts/print-analyst-config.ts <agentConfigId>
 *
 * Or with the default (Tech Momentum):
 *   npx tsx scripts/print-analyst-config.ts
 *
 * Useful for: "I'm about to fire app/discovery.run.manual — what will
 * the agent see?"
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
      signalTypes: true,
      marketCapMin: true,
      marketCapMax: true,
      exclusionList: true,
      minConfidence: true,
      maxOpenPositions: true,
      minPositionSize: true,
      maxPositionSize: true,
    },
  });

  if (!config) {
    console.error(`No AgentConfig found with id=${agentConfigId}.`);
    process.exit(1);
  }

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
  console.log("\nEDGE");
  console.log(`  direction bias: ${config.directionBias ?? "BOTH"}`);
  console.log(`  hold duration:  ${fmtList(config.holdDurations)}`);
  console.log(`  signal types:   ${fmtList(config.signalTypes)}`);
  console.log(`  min confidence: ${config.minConfidence ?? 70}%`);
  console.log(`  max positions:  ${config.maxOpenPositions ?? 5} slots`);
  console.log(`  pos size band:  $${config.minPositionSize ?? 0} \u2013 $${config.maxPositionSize ?? 500}`);

  console.log("");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[print-analyst-config] failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
