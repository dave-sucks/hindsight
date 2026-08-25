/**
 * L6 — turn the level columns already on theses into real triggers.
 *
 * > Design: docs/plans/LEVELS_AS_TRIGGERS.md
 *
 * Every write path mints triggers for its levels now, but rows written
 * BEFORE that shipped still carry a stop or target with nothing behind it.
 * This arms them, once.
 *
 * What it mints, per the 2026-08-24 ruling:
 *   stopLoss     -> EXIT   at that price      (a floor sells)
 *   targetPrice  -> REVIEW at that price      (a target wakes a decision)
 *   entryPrice   -> ENTER  at that price      (WATCHING only)
 *
 * Targets are REVIEW and never EXIT. Minting six auto-sells at numbers typed
 * weeks ago is the capped-winner behaviour the trigger ladder exists to
 * prevent.
 *
 * ## What this actually changes, measured 2026-08-25
 *
 *   HOLDING (8):  0 floors to arm, 5 targets   <- no new sell on a live position
 *   WATCHING (19): 19 floors, 19 targets       <- no money involved
 *
 * The held book's floors are already armed and are not touched. The 5 held
 * targets mint as REVIEW, so the worst case is a thesis surfacing for a
 * decision on the next daily run. The 19 watchlist floors resolve to DEMOTE
 * when breached — set the plan down, keep watching — which is bookkeeping.
 *
 * Skips any slot that already has a trigger, so it is idempotent and cannot
 * overwrite a level someone set by hand.
 *
 * Usage:
 *   npx tsx scripts/backfill-level-triggers.ts          # dry run, prints the plan
 *   npx tsx scripts/backfill-level-triggers.ts --apply  # writes
 */

import { prisma } from "@/lib/prisma";
import { applyLevelArgs } from "@/lib/agent/triggers/price-levels";
import { parseTriggersResilient } from "@/lib/agent/triggers/schema";
import { loadLevelSources, resolveThesisLadder } from "@/lib/agent/triggers/load-levels";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { randomUUID } from "node:crypto";
import type { Trigger } from "@/lib/agent/triggers/types";

const APPLY = process.argv.includes("--apply");

async function main() {
  const theses = await prisma.thesis.findMany({
    where: { status: { in: ["HOLDING", "WATCHING"] } },
    select: {
      id: true, ticker: true, status: true, direction: true, horizon: true,
      entryPrice: true, targetPrice: true, stopLoss: true,
      triggers: true, triggerState: true,
      researchRun: { select: { agentConfigId: true } },
    },
    orderBy: [{ status: "asc" }, { ticker: "asc" }],
  });

  const sources = await loadLevelSources(
    theses.map((t) => t.researchRun?.agentConfigId).filter((x): x is string => !!x),
  );

  let changed = 0;
  for (const t of theses) {
    const stored = parseTriggersResilient(t.triggers).triggers as Trigger[];
    // Resolve so an inherited floor counts as already-armed — we must not
    // stamp a thesis-level copy of a rule that lives on the account.
    const resolvedLadder = resolveThesisLadder(
      t,
      sources.get(t.researchRun?.agentConfigId ?? ""),
      `thesis=${t.id}`,
    );
    const inherited = resolvedLadder.filter((r) => r.inherited);

    // Only fill EMPTY slots. Passing `undefined` leaves a slot untouched.
    const before = applyLevelArgs({
      stored, inherited, levels: {}, direction: t.direction,
      status: t.status, mintId: () => randomUUID(),
    }).columns;

    const levels = {
      floor: before.stopLoss == null && t.stopLoss != null ? t.stopLoss : undefined,
      target: before.targetPrice == null && t.targetPrice != null ? t.targetPrice : undefined,
      entry:
        t.status === "WATCHING" && before.entryPrice == null && t.entryPrice != null
          ? t.entryPrice
          : undefined,
    };
    const mints = Object.entries(levels).filter(([, v]) => v !== undefined);
    if (mints.length === 0) continue;

    changed++;
    const plan = mints
      .map(([slot, v]) => `${slot === "floor" ? "sell below" : slot === "target" ? "review above" : "buy at"} $${v}`)
      .join(", ");
    console.log(`${APPLY ? "ARM " : "plan"}  ${t.status.padEnd(8)} ${t.ticker.padEnd(6)} ${plan}`);
    if (!APPLY) continue;

    const applied = applyLevelArgs({
      stored, inherited, levels, direction: t.direction, status: t.status,
      source: "PRINCIPAL", mintId: () => randomUUID(),
    });
    await prisma.thesis.update({
      where: { id: t.id },
      data: {
        triggers: applied.triggers as unknown as object[],
        entryPrice: applied.columns.entryPrice,
        targetPrice: applied.columns.targetPrice,
        stopLoss: applied.columns.stopLoss,
      },
    });
    // Visible in the activity log — a level that starts firing today should
    // not do so silently.
    await writeThesisUpdate({
      thesisId: t.id,
      type: "UPDATED",
      summary: `${t.ticker} levels armed — ${plan}`,
      rationale:
        `[BACKFILL] These prices were already on the thesis but nothing fired on them. ` +
        `They are real triggers now: ${plan}. A floor sells; a target wakes a decision on ` +
        `the next daily run. On a watchlist name a breached floor sets the plan down rather ` +
        `than selling anything.`,
      runId: null,
    });
  }

  console.log(
    `\n${changed} thesis(es) ${APPLY ? "armed" : "would be armed"}. ` +
      `${APPLY ? "" : "Re-run with --apply to write."}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
