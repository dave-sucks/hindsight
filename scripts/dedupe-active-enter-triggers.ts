/**
 * dedupe-active-enter-triggers.ts
 *
 * One-shot cleanup: every ACTIVE thesis with leftover ENTER-action
 * triggers gets them dropped and replaced with the HELD-side template
 * for its horizon.
 *
 * Why: pre-A2 (PR that landed 2026-05-19), `place_trade` flipped a
 * WATCHING thesis to ACTIVE but left the WATCHING-side triggers in
 * place — including ENTER triggers on the breakout level. The trigger
 * evaluator's 5-min cron then re-fired ENTER on the already-held
 * position every time price crossed the level. Audit on 2026-05-19:
 * 35 of 36 ENTER tactical runs over 14 days fired on already-held
 * tickers (AVGO 8×, GOOGL 7×, TSM 5×, etc.).
 *
 * This script repairs the existing rows. Future place_trade calls
 * regenerate the trigger set in-line, so this script is a one-shot.
 * Idempotent — re-running on an already-clean ACTIVE thesis does
 * nothing (no ENTER triggers found → skip).
 *
 * Run with:
 *   DRY_RUN=1 npx tsx scripts/dedupe-active-enter-triggers.ts
 *   npx tsx scripts/dedupe-active-enter-triggers.ts
 */

import { prisma } from "@/lib/prisma";
import {
  defaultTriggersForHorizon,
  applyTriggerCooldownDefaults,
  type Horizon,
} from "@/lib/agent/triggers/defaults";
import type { Trigger } from "@/lib/agent/triggers/types";

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  console.log(
    `[dedupe-active-enter] ${DRY_RUN ? "DRY RUN — no writes" : "APPLYING — writing to DB"}`,
  );

  const theses = await prisma.thesis.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      ticker: true,
      direction: true,
      horizon: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      maxHoldDays: true,
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
    const hasEnter = existingTriggers.some((tr) => tr.action === "ENTER");

    if (!hasEnter) {
      skipped += 1;
      continue;
    }

    const analystName = t.researchRun?.agentConfig?.name ?? "(unknown)";
    console.log(
      `  ${t.ticker} (${analystName}) — ${existingTriggers.length} triggers, ` +
        `${existingTriggers.filter((tr) => tr.action === "ENTER").length} ENTER`,
    );

    try {
      let nextTriggers: Trigger[];
      const horizon = t.horizon as Horizon | null;
      if (horizon && t.entryPrice != null) {
        const heldDefaults = defaultTriggersForHorizon(
          horizon,
          {
            entryPrice: Number(t.entryPrice),
            targetPrice: t.targetPrice != null ? Number(t.targetPrice) : null,
            stopLoss: t.stopLoss != null ? Number(t.stopLoss) : null,
            maxHoldDays: t.maxHoldDays ?? null,
            catalystDate: t.catalystDate ?? null,
            direction: t.direction as "LONG" | "SHORT",
          },
          "HELD",
        );
        nextTriggers = applyTriggerCooldownDefaults(heldDefaults);
      } else {
        // Conservative fallback: drop ENTER-action triggers, keep
        // everything else.
        nextTriggers = existingTriggers.filter((tr) => tr.action !== "ENTER");
      }

      console.log(
        `    → ${nextTriggers.length} triggers (${nextTriggers.filter((tr) => tr.action === "ENTER").length} ENTER, ${nextTriggers.filter((tr) => tr.action === "EXIT").length} EXIT, ${nextTriggers.filter((tr) => tr.action === "REVIEW").length} REVIEW)`,
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
            summary: `Dedupe stale ENTER triggers on ACTIVE ${t.ticker} (one-shot cleanup post-A2)`,
            rationale:
              "Pre-A2 place_trade left WATCHING-side triggers (including ENTER) " +
              "on the now-ACTIVE thesis. Regenerated for HELD-side template.",
            fieldChanges: {
              triggers: {
                from: `${existingTriggers.length} triggers (with ENTER)`,
                to: `${nextTriggers.length} triggers (HELD template)`,
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
  console.log(`touched: ${touched}, skipped (no ENTER): ${skipped}, errored: ${errored}`);
  console.log(`mode: ${DRY_RUN ? "DRY RUN" : "APPLIED"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
