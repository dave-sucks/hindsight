/**
 * dump-model-read.ts — what get_theses sends the model, for every analyst on
 * the trading account, written to one file to diff between two checkouts.
 *
 *   npx tsx --env-file=.env.local scripts/dump-model-read.ts <out-file>
 *
 * Read-only: the database reads, quotes, bars and the broker account read
 * that get_theses makes. Run it after the close in each checkout, back to
 * back, and compare the files byte for byte. Each analyst's default read
 * (the morning run's opening call) and its book read (every row in full) go
 * through the tool's own model output; the two fields that are clock
 * readings (`resolvedAt`, `quoteAgeMs`) are left out.
 *
 * The output carries the principal's words (notes in `context`, decline
 * messages): keep it out of the repo.
 */
import { writeFileSync } from "fs";
import { prisma } from "@/lib/prisma";
import { getTheses } from "@/lib/agent/tools/get-theses";
import { createToolContext } from "@/lib/agent/tool-context";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";

const CLOCK_KEYS = new Set(["resolvedAt", "quoteAgeMs"]);

function withoutClock(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutClock);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !CLOCK_KEYS.has(k))
        .map(([k, x]) => [k, withoutClock(x)]),
    );
  }
  return v;
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: dump-model-read.ts <out-file>");
  const analysts = await prisma.agentConfig.findMany({ where: { enabled: true }, orderBy: { name: "asc" } });
  const reads: Record<string, unknown> = {};
  for (const config of analysts) {
    const runEnvironment = (config.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
    const ctx = createToolContext({
      runId: "dump-model-read",
      userId: config.userId,
      accountId: config.accountId,
      analystId: config.id,
      runMode: "MORNING_PLAN",
      alpacaCreds: (await resolveAlpacaCredentials(config.userId, runEnvironment)) ?? undefined,
      runEnvironment,
      maxOpenPositions: config.maxOpenPositions,
      minConfidence: config.minConfidence,
      dryRun: true,
    } as Parameters<typeof createToolContext>[0]);
    const tool = getTheses(ctx) as unknown as {
      execute: (a: unknown) => Promise<unknown>;
      toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: unknown };
    };
    for (const [name, args] of [["default", { limit: 50 }], ["book", { detail: "book", limit: 50 }]] as const) {
      const output = await tool.execute(args);
      reads[`${config.name} — ${name}`] = withoutClock(tool.toModelOutput({ toolCallId: "dump", input: args, output }).value);
    }
  }
  writeFileSync(out, JSON.stringify(reads, null, 1) + "\n");
  console.log(`wrote ${out}: ${analysts.length} analysts, ${Object.keys(reads).length} reads`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
