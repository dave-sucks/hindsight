/**
 * fix-watching-next-review.ts
 *
 * One-shot repair: every WATCHING thesis whose nextReviewAt is shorter
 * than its horizon's first-review cadence gets nextReviewAt pushed out
 * to match WATCHING_FIRST_REVIEW_DAYS.
 *
 * Why: pre-A4 (PR landing 2026-05-19) `record_thesis` and the PENDING →
 * LONG/SHORT promotion in `update_thesis` used HORIZON_REVIEW_DAYS
 * (held-side cadence 1/1/7/30) for newly-minted WATCHING theses. The
 * 2026-05-17 Sunday discovery minted ~38 new WATCHING with too-short
 * nextReviewAt, then Monday 5/18 fired 28 REVIEW_DATE_HIT triggers as
 * a result. Production state on 2026-05-19:
 *
 *   COMPOUNDER  18 WATCHING — ALL 18 have nextReviewAt < 90d from creation
 *   TRADE       17 WATCHING — 16 have nextReviewAt < 14d from creation
 *   CATALYST    16 WATCHING — 14 have nextReviewAt < 14d
 *   TARGET       8 WATCHING — ALL 8  have nextReviewAt < 30d
 *
 * All 56 of those theses will fire premature REVIEW_DATE_HIT triggers
 * before WATCHING_FIRST_REVIEW_DAYS would have scheduled them. This
 * script repairs them.
 *
 * Strategy: for each affected thesis, compute the target nextReviewAt
 * as createdAt + WATCHING_FIRST_REVIEW_DAYS[horizon]. If the existing
 * nextReviewAt is already past that target (longer wait), leave alone
 * — the agent may have set it manually for a specific catalyst.
 *
 * Idempotent: re-running on a clean book does nothing.
 *
 * Run with:
 *   DRY_RUN=1 npx tsx scripts/fix-watching-next-review.ts
 *   npx tsx scripts/fix-watching-next-review.ts
 */

import { prisma } from "@/lib/prisma";
import {
  WATCHING_FIRST_REVIEW_DAYS,
  type Horizon,
} from "@/lib/agent/horizon-policy";

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  console.log(
    `[fix-watching-next-review] ${DRY_RUN ? "DRY RUN — no writes" : "APPLYING — writing to DB"}`,
  );

  const theses = await prisma.thesis.findMany({
    where: { status: "WATCHING", horizon: { not: null } },
    select: {
      id: true,
      ticker: true,
      direction: true,
      horizon: true,
      createdAt: true,
      nextReviewAt: true,
      researchRun: {
        select: {
          agentConfig: { select: { name: true } },
        },
      },
    },
  });

  let touched = 0;
  let skipped = 0;
  let errored = 0;
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const t of theses) {
    const horizon = t.horizon as Horizon;
    const targetDays = WATCHING_FIRST_REVIEW_DAYS[horizon];
    if (!targetDays) {
      skipped += 1;
      continue;
    }

    const targetNextReview = new Date(t.createdAt.getTime() + targetDays * dayMs);

    // Skip if the existing nextReviewAt is already at-or-past the target
    // — the agent may have manually set a longer cadence for a catalyst
    // and we don't want to compress it.
    if (t.nextReviewAt && t.nextReviewAt.getTime() >= targetNextReview.getTime()) {
      skipped += 1;
      continue;
    }

    // Also skip if the target is in the past (very old PENDING seed) —
    // pushing nextReviewAt to a past date is a no-op; let the cron
    // pick up the overdue review on its normal schedule.
    if (targetNextReview.getTime() < now) {
      skipped += 1;
      continue;
    }

    const analystName = t.researchRun?.agentConfig?.name ?? "(unknown)";
    const oldDate = t.nextReviewAt?.toISOString().slice(0, 10) ?? "(null)";
    const newDate = targetNextReview.toISOString().slice(0, 10);
    console.log(
      `  ${t.ticker} (${analystName}, ${horizon}) — nextReviewAt: ${oldDate} → ${newDate}`,
    );

    try {
      if (!DRY_RUN) {
        await prisma.thesis.update({
          where: { id: t.id },
          data: { nextReviewAt: targetNextReview },
        });
        await prisma.thesisUpdate.create({
          data: {
            thesisId: t.id,
            type: "UPDATED",
            summary: `Pushed nextReviewAt out to match ${horizon} first-review cadence (${targetDays}d)`,
            rationale:
              `Pre-A4 ${horizon} WATCHING theses got nextReviewAt set from the held-side cadence ` +
              `(too-short for new mints). Repaired to createdAt + ${targetDays}d to match the WATCHING ` +
              `hygiene cadence. One-shot cleanup; future mints use WATCHING_FIRST_REVIEW_DAYS directly.`,
            fieldChanges: {
              nextReviewAt: { from: oldDate, to: newDate },
            },
          },
        });
      }
      touched += 1;
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
  console.log(`touched: ${touched}, skipped (already in range or past): ${skipped}, errored: ${errored}`);
  console.log(`mode: ${DRY_RUN ? "DRY RUN" : "APPLIED"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
