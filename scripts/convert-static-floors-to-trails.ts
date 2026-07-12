/**
 * convert-static-floors-to-trails.ts
 *
 * ONE-OFF conversion (docs/plans/THESIS_GAME_PLAN.md §6 row D, §7).
 *
 * The 2026-07-09 hand-backfill gave all 11 live holdings full trigger
 * ladders via SQL (trigger ids prefixed `bf79-*`) — but the protective
 * floors in those ladders are STATIC price levels that reflect that day's
 * information forever (the exact IONS failure shape: a day-one floor that
 * is never re-earned). This script retrofits the three standing protection
 * minimums from `standingProtectionTriggers()` onto every one of those
 * ladders:
 *
 *   • GAIN_FROM_ENTRY {pct:10, direction:UP}   → REVIEW  (gain checkpoint)
 *   • TRAILING_FROM_HIGH {pct:8}               → EXIT    (mechanical ratchet)
 *   • GAIN_FROM_ENTRY {pct:12, direction:DOWN} → REVIEW  (loser attention)
 *
 * A rung is only ADDED when no same-bucket rung (same predicateKey +
 * action — see `triggerBucket`) is already present. Every existing trigger
 * is PRESERVED VERBATIM: `Thesis.triggers` is a wholesale-replace JSONB
 * column, so the script reads the raw array, appends the missing rungs,
 * and writes the full array back. It never rewrites, reorders, or dedupes
 * the hand-written rungs.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️  DEPLOY-ORDERING FOOTGUN — DO NOT RUN BEFORE PR-A IS LIVE IN PROD ⚠️
 *
 * GAIN_FROM_ENTRY and TRAILING_FROM_HIGH only exist in the trigger Zod
 * schema as of Game Plan PR-A (#477). Every reader of `Thesis.triggers`
 * (trigger-evaluator parseTriggers, get_theses, thesis-sheet-state,
 * tactical-run, live-evaluate) parses the WHOLE array through
 * `triggersArraySchema` — one unknown predicate kind fails the array parse
 * and silently drops ALL triggers on that thesis, INCLUDING the live EXIT
 * stops sitting next to it. Writing these predicate kinds to the prod DB
 * while prod still runs pre-PR-A code disarms every ladder this script
 * touches. Run it ONLY after the PR-A deploy is verified live.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   npx prisma generate                                     # FIRST on a cold checkout
 *   npx tsx --env-file=.env.local scripts/convert-static-floors-to-trails.ts             # DRY RUN (default)
 *   npx tsx --env-file=.env.local scripts/convert-static-floors-to-trails.ts --execute   # write
 *   npx tsx --env-file=.env.local scripts/convert-static-floors-to-trails.ts --execute --ticker=SNOW
 *
 * Dry-run is the DEFAULT — nothing is written without an explicit
 * --execute. Each modified thesis gets one ThesisUpdate audit row
 * (type UPDATED) naming the rungs added.
 */

import { prisma } from "@/lib/prisma";
import {
  applyTriggerCooldownDefaults,
  standingProtectionTriggers,
  triggerBucket,
} from "@/lib/agent/triggers/defaults";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { predicateSentence } from "@/lib/agent/triggers/format";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import type { Trigger } from "@/lib/agent/triggers/types";

/** The 2026-07-09 hand-backfill's trigger-id prefix — the target marker. */
const BACKFILL_ID_PREFIX = "bf79-";

type Flags = {
  execute: boolean;
  ticker: string | null;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { execute: false, ticker: null };
  for (const a of argv) {
    if (a === "--execute") flags.execute = true;
    else if (a === "--dry-run") flags.execute = false; // explicit, same as default
    else if (a.startsWith("--ticker=")) {
      flags.ticker = a.slice("--ticker=".length).toUpperCase();
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    }
  }
  return flags;
}

type Outcome = {
  ticker: string;
  analystName: string;
  status: "ADDED" | "ALREADY_COMPLETE" | "SKIPPED_UNPARSEABLE" | "FAILED";
  added: string[];
  error?: string;
};

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log(
    `[convert-static-floors-to-trails] ${
      flags.execute ? "EXECUTE — writing to DB" : "DRY RUN (default) — no writes; pass --execute to apply"
    }`,
  );

  // Every HOLDING thesis, LIVE-analyst-scoped; the bf79-* filter below is
  // the real target marker (the hand-backfill only touched live holdings,
  // but belt-and-suspenders: skip anything not on a LIVE analyst).
  const theses = await prisma.thesis.findMany({
    where: {
      status: "HOLDING",
      ...(flags.ticker ? { ticker: flags.ticker } : {}),
    },
    select: {
      id: true,
      ticker: true,
      triggers: true,
      researchRun: {
        select: {
          agentConfig: { select: { name: true, tradingEnvironment: true } },
        },
      },
    },
    orderBy: { ticker: "asc" },
  });

  const outcomes: Outcome[] = [];

  for (const t of theses) {
    const analystName = t.researchRun?.agentConfig?.name ?? "(unknown analyst)";
    const env = t.researchRun?.agentConfig?.tradingEnvironment ?? "PAPER";

    // Raw array — used both for the bf79 marker check and (crucially) as
    // the preserved half of the write. We deliberately do NOT write the
    // Zod-parsed copy back: parsing materializes schema defaults (e.g.
    // fireMode "TACTICAL") onto rungs that stored the field as absent,
    // and "preserve every existing trigger" means byte-for-byte.
    const raw: Trigger[] = Array.isArray(t.triggers)
      ? (t.triggers as unknown as Trigger[])
      : [];

    const isBackfilled = raw.some(
      (tr) => typeof tr?.id === "string" && tr.id.startsWith(BACKFILL_ID_PREFIX),
    );
    if (!isBackfilled) continue; // not part of the 2026-07-09 hand-backfill
    if (env !== "LIVE") {
      console.log(
        `  ⊘ ${t.ticker.padEnd(6)} (${analystName}) — has ${BACKFILL_ID_PREFIX}* ids but analyst env=${env}; skipping (LIVE only)`,
      );
      continue;
    }

    // Validation gate BEFORE building the write: if the existing array
    // doesn't parse, refuse — appending to an unparseable array and
    // writing it back could persist a shape every reader drops wholesale.
    const parsed = triggersArraySchema.safeParse(t.triggers);
    if (!parsed.success) {
      console.log(
        `  ✗ ${t.ticker.padEnd(6)} (${analystName}) — existing triggers don't parse; NOT touching (fix the row first)`,
      );
      outcomes.push({
        ticker: t.ticker,
        analystName,
        status: "SKIPPED_UNPARSEABLE",
        added: [],
        error: parsed.error.issues.map((i) => i.message).join("; "),
      });
      continue;
    }

    // Same-bucket check against EVERY existing trigger (hand-written or
    // agent-written): a ladder that already carries e.g. its own
    // GAIN_FROM_ENTRY UP → REVIEW keeps it — we never stack a duplicate.
    const existingBuckets = new Set(raw.map((tr) => triggerBucket(tr)));
    const missing = standingProtectionTriggers().filter(
      (rung) => !existingBuckets.has(triggerBucket(rung)),
    );
    // Cooldown bookkeeping on the NEW rungs only (REVIEW rungs get the
    // per-kind GAIN 7d default; the trail EXIT keeps its explicit 0).
    const toAdd = applyTriggerCooldownDefaults(missing);

    if (toAdd.length === 0) {
      console.log(
        `  • ${t.ticker.padEnd(6)} (${analystName}) — all 3 protection buckets already present; nothing to add`,
      );
      outcomes.push({
        ticker: t.ticker,
        analystName,
        status: "ALREADY_COMPLETE",
        added: [],
      });
      continue;
    }

    const next = [...raw, ...toAdd];
    const wholeArray = triggersArraySchema.safeParse(next);
    if (!wholeArray.success) {
      console.log(
        `  ✗ ${t.ticker.padEnd(6)} (${analystName}) — merged array fails validation (20-cap?); NOT touching`,
      );
      outcomes.push({
        ticker: t.ticker,
        analystName,
        status: "FAILED",
        added: [],
        error: wholeArray.error.issues.map((i) => i.message).join("; "),
      });
      continue;
    }

    const addedLabels = toAdd.map(
      (r) => `${predicateSentence(r.predicate)} → ${r.action.toLowerCase()}`,
    );
    console.log(
      `  ${flags.execute ? "✓" : "→"} ${t.ticker.padEnd(6)} (${analystName}) — ${raw.length} existing kept, adding ${toAdd.length}:`,
    );
    for (const label of addedLabels) console.log(`        + ${label}`);

    if (flags.execute) {
      try {
        await prisma.thesis.update({
          where: { id: t.id },
          data: { triggers: next as unknown as object },
        });
        await writeThesisUpdate({
          thesisId: t.id,
          type: "UPDATED",
          summary: `Standing protection minimums added — ${addedLabels.join("; ")}`,
          rationale:
            `[SCRIPT convert-static-floors-to-trails] The 2026-07-09 hand-backfilled ` +
            `ladder carried only static price floors — entry-day information that is ` +
            `never re-earned (the IONS failure). Added the standing protection ` +
            `minimums (gain checkpoint +10% → review, 8% trail off the high → exit, ` +
            `−12% loser attention → review) alongside the existing rungs; every ` +
            `hand-written trigger was preserved unchanged. These are the same rungs ` +
            `every future HELD mint gets from defaultTriggersForHorizon. See ` +
            `docs/plans/THESIS_GAME_PLAN.md.`,
          fieldChanges: {
            triggers: { from: raw.length, to: next.length },
          },
          runId: null,
        });
        outcomes.push({
          ticker: t.ticker,
          analystName,
          status: "ADDED",
          added: addedLabels,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ ${t.ticker.padEnd(6)} (${analystName}) — write failed: ${msg}`);
        outcomes.push({
          ticker: t.ticker,
          analystName,
          status: "FAILED",
          added: [],
          error: msg,
        });
      }
    } else {
      outcomes.push({
        ticker: t.ticker,
        analystName,
        status: "ADDED",
        added: addedLabels,
      });
    }
  }

  const added = outcomes.filter((o) => o.status === "ADDED");
  const complete = outcomes.filter((o) => o.status === "ALREADY_COMPLETE");
  const skipped = outcomes.filter((o) => o.status === "SKIPPED_UNPARSEABLE");
  const failed = outcomes.filter((o) => o.status === "FAILED");

  console.log(`\n=== Summary (${flags.execute ? "EXECUTED" : "DRY RUN"}) ===`);
  console.log(`Backfilled ladders found: ${outcomes.length}`);
  console.log(`Rungs ${flags.execute ? "added" : "to add"}:        ${added.length} thesis/theses`);
  console.log(`Already complete:         ${complete.length}`);
  console.log(`Skipped (unparseable):    ${skipped.length}`);
  console.log(`Failed:                   ${failed.length}`);
  if (!flags.execute && added.length > 0) {
    console.log(`\nRe-run with --execute to apply (ONLY after PR-A is live in prod — see header).`);
  }
  console.log("");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[convert-static-floors-to-trails] FATAL:", err);
  await prisma.$disconnect();
  process.exit(1);
});
