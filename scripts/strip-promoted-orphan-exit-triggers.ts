/**
 * strip-promoted-orphan-exit-triggers.ts
 *
 * One-shot cleanup: every PROMOTED thesis with leftover HELD-template
 * triggers (EXIT, TRIM, ADD, MOVE_STOP) gets them stripped and replaced
 * with the PROMOTED-side template for its horizon.
 *
 * Why: pre-P1-21 (this PR), the promote-analyst action flipped a thesis
 * ACTIVE → PROMOTED but left the predecessor HELD-side triggers in
 * place — including EXIT on the old stop. The trigger evaluator's 5-min
 * cron then re-fired EXIT on the (now-position-less) PROMOTED thesis
 * whenever price crossed the stop. tactical-run would either skip
 * cleanly (current behavior: status filter rejects non-ACTIVE/WATCHING)
 * or fall through to close_position which would refuse with a "no
 * position to close" message. Either way: orphan compute + log noise on
 * the first day of live trading.
 *
 * This script repairs the existing rows. promote-analyst now regenerates
 * the trigger set in-line per P1-21, so this script is a one-shot.
 * Idempotent — re-running on an already-clean PROMOTED thesis does
 * nothing (no orphan action triggers found → skip).
 *
 * Today (2026-05-24) this finds 0 rows — no analyst has been promoted
 * yet. Defensive after first promotion.
 *
 * Run with:
 *   DRY_RUN=1 npx tsx scripts/strip-promoted-orphan-exit-triggers.ts
 *   npx tsx scripts/strip-promoted-orphan-exit-triggers.ts
 *
 * NOTE (TD-4): run `npx prisma generate` first, or this script will
 * fail with ~31 PROMOTED enum errors against a stale generated client.
 */

import { prisma } from "@/lib/prisma";
import {
  defaultTriggersForHorizon,
  applyTriggerCooldownDefaults,
  type Horizon,
} from "@/lib/agent/triggers/defaults";
import type { Trigger, TriggerAction } from "@/lib/agent/triggers/types";

const DRY_RUN = process.env.DRY_RUN === "1";

const ORPHAN_ACTIONS: TriggerAction[] = ["EXIT", "TRIM", "ADD", "MOVE_STOP"];

async function main() {
  console.log(
    `[strip-promoted-orphan-exit] ${DRY_RUN ? "DRY RUN — no writes" : "APPLYING — writing to DB"}`,
  );

  const theses = await prisma.thesis.findMany({
    where: { status: "PROMOTED" },
    select: {
      id: true,
      ticker: true,
      direction: true,
      horizon: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      catalystDate: true,
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
  let errored = 0;

  for (const t of theses) {
    const existingTriggers =
      (t.triggers as unknown as Trigger[] | null) ?? [];
    const orphanCount = existingTriggers.filter((tr) =>
      ORPHAN_ACTIONS.includes(tr.action),
    ).length;

    if (orphanCount === 0) {
      skipped += 1;
      continue;
    }

    const analystName = t.researchRun?.agentConfig?.name ?? "(unknown)";
    console.log(
      `  ${t.ticker} (${analystName}) — ${existingTriggers.length} triggers, ` +
        `${orphanCount} orphan (EXIT/TRIM/ADD/MOVE_STOP)`,
    );

    try {
      let nextTriggers: Trigger[];
      const horizon = t.horizon as Horizon | null;
      if (horizon) {
        const promotedDefaults = defaultTriggersForHorizon(
          horizon,
          {
            entryPrice: t.entryPrice != null ? Number(t.entryPrice) : null,
            targetPrice: t.targetPrice != null ? Number(t.targetPrice) : null,
            stopLoss: t.stopLoss != null ? Number(t.stopLoss) : null,
            catalystDate: t.catalystDate ?? null,
            direction: t.direction as "LONG" | "SHORT",
          },
          "PROMOTED",
        );
        nextTriggers = applyTriggerCooldownDefaults(promotedDefaults);
      } else {
        // No horizon → can't pick a template. Conservative fallback:
        // strip orphan-action triggers and keep everything else (REVIEW
        // and any ENTER triggers stay; PROMOTED is meant to have those).
        nextTriggers = existingTriggers.filter(
          (tr) => !ORPHAN_ACTIONS.includes(tr.action),
        );
      }

      console.log(
        `    → ${nextTriggers.length} triggers ` +
          `(${nextTriggers.filter((tr) => tr.action === "ENTER").length} ENTER, ` +
          `${nextTriggers.filter((tr) => tr.action === "EXIT").length} EXIT, ` +
          `${nextTriggers.filter((tr) => tr.action === "REVIEW").length} REVIEW)`,
      );

      if (!DRY_RUN) {
        await prisma.thesis.update({
          where: { id: t.id },
          data: { triggers: nextTriggers as unknown as object },
        });
        await prisma.thesisUpdate.create({
          data: {
            thesisId: t.id,
            type: "UPDATED",
            summary: `Stripped orphan HELD-template triggers as part of P1-21 cleanup; replaced with PROMOTED-template set.`,
            rationale:
              "Pre-P1-21 promote-analyst left HELD-side triggers (EXIT/TRIM/ADD/MOVE_STOP) " +
              "on theses transitioned ACTIVE→PROMOTED. Those triggers would spawn orphan " +
              "tactical EXIT runs on a thesis with no position to close. Regenerated for " +
              "PROMOTED-side template (ENTER + REVIEW only).",
            fieldChanges: {
              triggers: {
                from: `${existingTriggers.length} triggers (with ${orphanCount} orphan HELD-action)`,
                to: `${nextTriggers.length} triggers (PROMOTED template)`,
              },
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
  console.log(
    `touched: ${touched}, skipped (no orphans): ${skipped}, errored: ${errored}`,
  );
  console.log(`mode: ${DRY_RUN ? "DRY RUN" : "APPLIED"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
