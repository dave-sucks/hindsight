/**
 * backfill-research.ts
 *
 * ONE-OFF first-launch prep script. Refreshes the deep-research thesis (V2
 * 9-section dossier) on every WATCHING + ACTIVE thesis across every enabled
 * analyst by invoking `runThesisWriterAgent` inline, sequentially, with each
 * child run logged as a top-level ResearchRun row (parentRunId=null) so the
 * principal can watch progress live at /runs.
 *
 * Why a script (not the dispatch tool / Inngest event):
 *   - Tighter sequencing: one process owns the queue, no chance of
 *     two refreshes racing on the same ticker.
 *   - Easier debugging: failures bubble up to a single log stream.
 *   - One-off: post-launch, refreshes happen in-band via dispatch from
 *     agents (THESIS_LIFECYCLE_FIX Phase 2). Don't generalize this script.
 *
 * Usage:
 *   npx prisma generate                                   # FIRST if cold checkout (TD-4)
 *   npx tsx scripts/backfill-research.ts --dry-run        # preview the target list
 *   npx tsx scripts/backfill-research.ts                  # run full backfill (sequential)
 *   npx tsx scripts/backfill-research.ts --ticker=AVGO    # one ticker (test / retry)
 *   npx tsx scripts/backfill-research.ts --analyst-id=... # one analyst's theses
 *   npx tsx scripts/backfill-research.ts --concurrency=3  # 3 in parallel (rate-limit risk)
 */

import { prisma } from "@/lib/prisma";
import { runThesisWriterAgent } from "@/lib/agent/run-thesis-writer";

const COST_PER_REFRESH_USD = 0.21;

type Flags = {
  dryRun: boolean;
  analystId: string | null;
  ticker: string | null;
  concurrency: number;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: false,
    analystId: null,
    ticker: null,
    concurrency: 1,
  };
  for (const a of argv) {
    if (a === "--dry-run") flags.dryRun = true;
    else if (a.startsWith("--analyst-id=")) flags.analystId = a.slice("--analyst-id=".length);
    else if (a.startsWith("--ticker=")) flags.ticker = a.slice("--ticker=".length).toUpperCase();
    else if (a.startsWith("--concurrency=")) {
      const n = Number(a.slice("--concurrency=".length));
      if (Number.isFinite(n) && n >= 1 && n <= 3) flags.concurrency = Math.floor(n);
      else {
        console.error(`--concurrency must be 1..3, got "${a.slice("--concurrency=".length)}"`);
        process.exit(1);
      }
    }
  }
  return flags;
}

type Target = {
  thesisId: string;
  ticker: string;
  status: "WATCHING" | "ACTIVE";
  researchUpdatedAt: Date | null;
  analyst: {
    id: string;
    name: string;
    userId: string;
    accountId: string;
  };
  environment: string;
};

async function loadTargets(flags: Flags): Promise<Target[]> {
  const theses = await prisma.thesis.findMany({
    where: {
      status: { in: ["WATCHING", "ACTIVE"] },
      ...(flags.ticker ? { ticker: flags.ticker } : {}),
      researchRun: {
        agentConfig: {
          enabled: true,
          ...(flags.analystId ? { id: flags.analystId } : {}),
        },
      },
    },
    select: {
      id: true,
      ticker: true,
      status: true,
      researchUpdatedAt: true,
      researchRun: {
        select: {
          environment: true,
          agentConfig: {
            select: { id: true, name: true, userId: true, accountId: true },
          },
        },
      },
    },
    orderBy: [
      { researchRun: { agentConfig: { name: "asc" } } },
      { ticker: "asc" },
    ],
  });

  const out: Target[] = [];
  for (const t of theses) {
    const ac = t.researchRun.agentConfig;
    if (!ac) continue; // orphaned run, skip
    out.push({
      thesisId: t.id,
      ticker: t.ticker,
      status: t.status as "WATCHING" | "ACTIVE",
      researchUpdatedAt: t.researchUpdatedAt,
      analyst: {
        id: ac.id,
        name: ac.name,
        userId: ac.userId,
        accountId: ac.accountId,
      },
      environment: t.researchRun.environment,
    });
  }
  return out;
}

function ageDays(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function fmtAge(d: Date | null): string {
  const age = ageDays(d);
  if (age == null) return "never";
  return `${age}d`;
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

function printDryRun(targets: Target[]) {
  const byAnalyst = new Map<string, Target[]>();
  for (const t of targets) {
    const arr = byAnalyst.get(t.analyst.name) ?? [];
    arr.push(t);
    byAnalyst.set(t.analyst.name, arr);
  }

  console.log(`\nDRY RUN — ${targets.length} thesis(es) to refresh\n`);
  for (const [analystName, rows] of [...byAnalyst.entries()].sort()) {
    console.log(`▸ ${analystName} (${rows.length})`);
    for (const t of rows) {
      console.log(
        `    ${t.ticker.padEnd(6)} ${t.status.padEnd(8)}  ` +
          `research_updated_at=${fmtDate(t.researchUpdatedAt)}  ` +
          `age=${fmtAge(t.researchUpdatedAt).padStart(6)}`,
      );
    }
  }

  const missing = targets.filter((t) => t.researchUpdatedAt == null).length;
  const stale = targets.filter((t) => {
    const age = ageDays(t.researchUpdatedAt);
    return age != null && age > 14;
  }).length;
  const fresh = targets.length - missing - stale;

  console.log(
    `\nTotals: ${targets.length} total — ${missing} missing (no V2 write yet), ${stale} stale (>14d), ${fresh} fresh.`,
  );
  console.log(
    `Est. cost on a real run: ~$${(targets.length * COST_PER_REFRESH_USD).toFixed(2)} ` +
      `(${targets.length} × ~$${COST_PER_REFRESH_USD.toFixed(2)}/avg)`,
  );
  console.log(`\nRe-run without --dry-run to fire.\n`);
}

type RefreshOutcome = {
  index: number;
  target: Target;
  status: "COMPLETE" | "FAILED";
  thesisId: string | null;
  toolCalls: number;
  elapsedMs: number;
  error?: string;
};

async function refreshOne(
  target: Target,
  index: number,
  total: number,
): Promise<RefreshOutcome> {
  const labelIdx = `[${String(index + 1).padStart(String(total).length)}/${total}]`;
  console.log(
    `${labelIdx} Refreshing ${target.ticker.padEnd(6)} (${target.analyst.name})...`,
  );

  const reason =
    "Backfill: refreshing pre-V2 thesis research for first prod launch";

  try {
    const childRun = await prisma.researchRun.create({
      data: {
        userId: target.analyst.userId,
        accountId: target.analyst.accountId,
        agentConfigId: target.analyst.id,
        source: "AGENT",
        status: "RUNNING",
        mode: "THESIS_WRITER",
        environment: target.environment,
        parameters: {
          ticker: target.ticker,
          mode: "refresh",
          existingThesisId: target.thesisId,
          reason,
          backfill: true,
          dispatchedAt: new Date().toISOString(),
        } as object,
      },
      select: { id: true },
    });

    const result = await runThesisWriterAgent({
      childRunId: childRun.id,
      analystId: target.analyst.id,
      ticker: target.ticker,
      mode: "refresh",
      existingThesisId: target.thesisId,
      reason,
      forceWatchingMint: false,
    });

    const seconds = Math.round(result.elapsedMs / 1000);
    if (result.status === "COMPLETE") {
      console.log(
        `  ✓ COMPLETE in ${seconds}s — thesisId ${result.thesisId?.slice(0, 8) ?? "—"}, ${result.toolCalls} tool calls`,
      );
    } else {
      console.log(
        `  ✗ FAILED in ${seconds}s — ${result.error ?? "no error message"}`,
      );
    }
    return {
      index,
      target,
      status: result.status,
      thesisId: result.thesisId,
      toolCalls: result.toolCalls,
      elapsedMs: result.elapsedMs,
      error: result.error,
    };
  } catch (err) {
    // Belt-and-suspenders — the worker has its own outer try/catch, but a
    // throw between childRun.create and runThesisWriterAgent (or a bug in
    // the worker that escapes its catch) shouldn't abort the whole script.
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ FAILED (script-level catch) — ${msg}`);
    return {
      index,
      target,
      status: "FAILED",
      thesisId: null,
      toolCalls: 0,
      elapsedMs: 0,
      error: msg,
    };
  }
}

async function refreshAll(
  targets: Target[],
  concurrency: number,
): Promise<RefreshOutcome[]> {
  const outcomes: RefreshOutcome[] = [];
  if (concurrency <= 1) {
    for (let i = 0; i < targets.length; i++) {
      outcomes.push(await refreshOne(targets[i], i, targets.length));
    }
    return outcomes;
  }
  // Chunked Promise.all — concurrency 2..3
  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((t, j) => refreshOne(t, i + j, targets.length)),
    );
    outcomes.push(...chunkResults);
  }
  return outcomes;
}

function printSummary(outcomes: RefreshOutcome[], wallTimeMs: number) {
  const succeeded = outcomes.filter((o) => o.status === "COMPLETE");
  const failed = outcomes.filter((o) => o.status === "FAILED");
  const wallMin = (wallTimeMs / 60_000).toFixed(0);
  const successPct =
    outcomes.length === 0
      ? "0.0"
      : ((succeeded.length / outcomes.length) * 100).toFixed(1);

  console.log(`\n=== Backfill Summary ===`);
  console.log(`Targets:     ${outcomes.length}`);
  console.log(`Succeeded:   ${succeeded.length} (${successPct}%)`);
  console.log(`Failed:      ${failed.length}`);
  console.log(`Wall time:   ${wallMin} min`);
  console.log(
    `Est. cost:  ~$${(succeeded.length * COST_PER_REFRESH_USD).toFixed(2)} ` +
      `(${succeeded.length} × ~$${COST_PER_REFRESH_USD.toFixed(2)}/avg)`,
  );

  if (failed.length > 0) {
    console.log(`\nFailed (retry via --ticker=X):`);
    for (const o of failed) {
      console.log(
        `  - ${o.target.ticker.padEnd(5)} (${o.target.analyst.name}): ${o.error ?? "unknown error"}`,
      );
    }
  }
  console.log("");
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  const targets = await loadTargets(flags);
  if (targets.length === 0) {
    console.log(
      "No WATCHING/ACTIVE theses found for enabled analyst(s). Nothing to do.",
    );
    await prisma.$disconnect();
    return;
  }

  if (flags.dryRun) {
    printDryRun(targets);
    await prisma.$disconnect();
    return;
  }

  console.log(
    `\nBackfilling ${targets.length} thesis(es) with concurrency=${flags.concurrency}.`,
  );
  console.log(
    `Each refresh takes ~60-120s. ETA: ~${Math.round(((targets.length * 90) / flags.concurrency) / 60)} min.\n`,
  );

  const t0 = Date.now();
  const outcomes = await refreshAll(targets, flags.concurrency);
  const wallTimeMs = Date.now() - t0;

  printSummary(outcomes, wallTimeMs);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("backfill-research failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
