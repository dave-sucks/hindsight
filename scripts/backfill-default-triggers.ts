/**
 * backfill-default-triggers.ts
 *
 * One-shot backfill: every ACTIVE + WATCHING thesis with empty
 * triggers[] gets the horizon-keyed default template applied.
 *
 * Idempotent — re-running does nothing on theses that already have
 * triggers (the merge step keeps existing triggers; we'd skip them
 * upstream anyway).
 *
 * Run with:
 *   DRY_RUN=1 npx tsx scripts/backfill-default-triggers.ts   # preview
 *   npx tsx scripts/backfill-default-triggers.ts             # apply
 *
 * Output: per-thesis summary of triggers added; final tally of theses
 * touched / skipped / errored.
 */

import { prisma } from "@/lib/prisma";
import {
  defaultTriggersForHorizon,
  type Horizon,
} from "@/lib/agent/triggers/defaults";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  console.log(
    `[backfill-default-triggers] ${DRY_RUN ? "DRY RUN — no writes" : "APPLYING — writing to DB"}`,
  );

  const theses = await prisma.thesis.findMany({
    where: {
      status: { in: ["HOLDING", "WATCHING"] },
    },
    select: {
      id: true,
      ticker: true,
      direction: true,
      status: true,
      horizon: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      maxHoldDays: true,
      catalystDate: true,
      triggers: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `[backfill-default-triggers] ${theses.length} active+watching theses to consider`,
  );

  let touched = 0;
  let skippedAlreadyHasTriggers = 0;
  let skippedNoHorizon = 0;
  let errored = 0;

  for (const t of theses) {
    try {
      const parsed = triggersArraySchema.safeParse(t.triggers);
      const existing = parsed.success ? parsed.data : [];
      if (existing.length > 0) {
        skippedAlreadyHasTriggers++;
        continue;
      }
      if (!t.horizon) {
        skippedNoHorizon++;
        console.log(
          `  • SKIP $${t.ticker} (${t.id}) — no horizon set`,
        );
        continue;
      }

      const defaults = defaultTriggersForHorizon(t.horizon as Horizon, {
        entryPrice: t.entryPrice,
        targetPrice: t.targetPrice,
        stopLoss: t.stopLoss,
        maxHoldDays: t.maxHoldDays,
        catalystDate: t.catalystDate,
      });

      console.log(
        `  • $${t.ticker} (${t.direction}, ${t.horizon}) ← ${defaults.length} default trigger(s)`,
      );
      for (const d of defaults) {
        console.log(
          `      ${d.action.padEnd(9)} ${d.predicate.kind.padEnd(20)} ${d.rationale.slice(0, 70)}`,
        );
      }

      if (!DRY_RUN) {
        await prisma.thesis.update({
          where: { id: t.id },
          data: { triggers: defaults as unknown as object[] },
        });
      }
      touched++;
    } catch (err) {
      errored++;
      console.error(
        `  • ERROR on $${t.ticker} (${t.id}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log("");
  console.log("[backfill-default-triggers] Summary:");
  console.log(`  ${touched} thesis/theses ${DRY_RUN ? "would be touched" : "touched"}`);
  console.log(`  ${skippedAlreadyHasTriggers} skipped (already had triggers)`);
  console.log(`  ${skippedNoHorizon} skipped (no horizon set)`);
  console.log(`  ${errored} errored`);
  console.log("");
  if (DRY_RUN && touched > 0) {
    console.log(
      `Re-run without DRY_RUN=1 to apply.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-default-triggers] FATAL:", err);
    process.exit(1);
  });
