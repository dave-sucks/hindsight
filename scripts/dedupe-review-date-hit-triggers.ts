/**
 * dedupe-review-date-hit-triggers.ts
 *
 * One-shot cleanup: drop REVIEW_DATE_HIT predicate triggers from every
 * ACTIVE + WATCHING thesis. They were auto-attached by the pre-2026-05-20
 * default templates to spawn a tactical run when `nextReviewAt` passed.
 *
 * Daily-run already handles the same condition via
 * `get_theses.needsAction.REVIEW_DUE` (reads `Thesis.nextReviewAt < now`),
 * so the trigger was redundant — produced 28 of 35 tactical runs on
 * 2026-05-18 with no actionable output. The defaults.ts change in
 * fix(triggers): drop REVIEW_DATE_HIT from watching defaults strips
 * them going forward; this script repairs existing rows.
 *
 * Conservative: only drops REVIEW_DATE_HIT-kind triggers. Leaves
 * earnings/filings/guidance/time-elapsed triggers alone (those are
 * event-driven and fire less often). Agent-declared custom triggers
 * are untouched.
 *
 * Idempotent — re-running on an already-clean thesis does nothing.
 *
 * Run with:
 *   DRY_RUN=1 npx tsx scripts/dedupe-review-date-hit-triggers.ts
 *   npx tsx scripts/dedupe-review-date-hit-triggers.ts
 */

import { prisma } from "@/lib/prisma";
import type { Trigger } from "@/lib/agent/triggers/types";

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  console.log(
    `[dedupe-review-date-hit] ${DRY_RUN ? "DRY RUN — no writes" : "APPLYING — writing to DB"}`,
  );

  const theses = await prisma.thesis.findMany({
    where: { status: { in: ["ACTIVE", "WATCHING"] } },
    select: {
      id: true,
      ticker: true,
      status: true,
      triggers: true,
      researchRun: {
        select: {
          agentConfig: { select: { name: true } },
        },
      },
    },
  });

  let touched = 0;
  let skipped = 0;
  let triggersRemoved = 0;
  let errored = 0;

  for (const t of theses) {
    const existing = (t.triggers as unknown as Trigger[] | null) ?? [];
    const next = existing.filter((tr) => tr.predicate.kind !== "REVIEW_DATE_HIT");
    const removed = existing.length - next.length;

    if (removed === 0) {
      skipped += 1;
      continue;
    }

    const analystName = t.researchRun?.agentConfig?.name ?? "(unknown)";
    console.log(
      `  ${t.ticker} (${analystName}, ${t.status}) — removing ${removed} REVIEW_DATE_HIT trigger${removed > 1 ? "s" : ""} (${existing.length} → ${next.length})`,
    );

    try {
      if (!DRY_RUN) {
        await prisma.thesis.update({
          where: { id: t.id },
          data: { triggers: next as unknown as object },
        });
        await prisma.thesisUpdate.create({
          data: {
            thesisId: t.id,
            type: "UPDATED",
            summary: `Removed ${removed} REVIEW_DATE_HIT trigger${removed > 1 ? "s" : ""} (cleanup)`,
            rationale:
              "Cleanup: daily-run's needsAction.REVIEW_DUE reads " +
              "nextReviewAt directly; the duplicate trigger is removed.",
            fieldChanges: {
              triggers: {
                from: `${existing.length} triggers`,
                to: `${next.length} triggers (REVIEW_DATE_HIT removed)`,
              },
            },
          },
        });
      }
      touched += 1;
      triggersRemoved += removed;
    } catch (err) {
      console.error(
        `    ✗ failed on ${t.id}:`,
        err instanceof Error ? err.message : err,
      );
      errored += 1;
    }
  }

  console.log("");
  console.log("─".repeat(60));
  console.log(
    `touched: ${touched}, skipped (no REVIEW_DATE_HIT): ${skipped}, errored: ${errored}`,
  );
  console.log(`total triggers removed: ${triggersRemoved}`);
  console.log(`mode: ${DRY_RUN ? "DRY RUN" : "APPLIED"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
