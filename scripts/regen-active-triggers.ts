/**
 * regen-active-triggers.ts
 *
 * ONE-OFF repair script. Regenerates HELD-template triggers on every
 * ACTIVE thesis on enabled analysts whose triggers field got corrupted
 * by the 2026-05-26 backfill (PR #339's "you are writing a WATCHING
 * thesis" prompt blanket-applied to ACTIVE refreshes, stripping EXIT
 * predicates from 9 of 10 held paper positions).
 *
 * Pure DB rewrite — no agent involvement. For each target thesis:
 *   1. Read horizon + entryPrice + targetPrice + stopLoss + maxHoldDays
 *      + catalystDate + direction.
 *   2. Call defaultTriggersForHorizon(horizon, shape, "HELD") to
 *      generate the canonical HELD template (EXIT on stop, REVIEW on
 *      target / earnings / filings, time hygiene per horizon).
 *   3. applyTriggerCooldownDefaults() to backfill cooldownDays.
 *   4. UPDATE Thesis.triggers + write a ThesisUpdate audit row of type
 *      "UPDATED" naming the source bug.
 *
 * Usage:
 *   npx prisma generate                                              # FIRST if cold checkout (TD-4)
 *   npx tsx --env-file=.env.local scripts/regen-active-triggers.ts --dry-run    # preview targets
 *   npx tsx --env-file=.env.local scripts/regen-active-triggers.ts              # interactive confirm
 *   npx tsx --env-file=.env.local scripts/regen-active-triggers.ts --yes        # skip confirm
 *   npx tsx --env-file=.env.local scripts/regen-active-triggers.ts --ticker=MRVL
 *   npx tsx --env-file=.env.local scripts/regen-active-triggers.ts --analyst-id=cmm...
 *
 * Post-launch this script should NOT be needed — the symmetric Layer-1
 * guard added in the same PR rejects ENTER-on-ACTIVE writes at the tool
 * boundary. Don't generalize this script; it's a one-off cleanup.
 */

import { prisma } from "@/lib/prisma";
import {
  defaultTriggersForHorizon,
  applyTriggerCooldownDefaults,
  type Horizon,
} from "@/lib/agent/triggers/defaults";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import type { Trigger } from "@/lib/agent/triggers/types";
import * as readline from "node:readline/promises";

type Flags = {
  dryRun: boolean;
  yes: boolean;
  analystId: string | null;
  ticker: string | null;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: false,
    yes: false,
    analystId: null,
    ticker: null,
  };
  for (const a of argv) {
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a.startsWith("--analyst-id=")) {
      flags.analystId = a.slice("--analyst-id=".length);
    } else if (a.startsWith("--ticker=")) {
      flags.ticker = a.slice("--ticker=".length).toUpperCase();
    }
  }
  return flags;
}

type Target = {
  thesisId: string;
  ticker: string;
  direction: "LONG" | "SHORT";
  horizon: Horizon | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  maxHoldDays: number | null;
  catalystDate: Date | null;
  existingTriggers: Trigger[];
  analystName: string;
};

function summarizeTriggers(triggers: Trigger[]): {
  enter: number;
  exit: number;
  trim: number;
  add: number;
  moveStop: number;
  review: number;
} {
  let enter = 0;
  let exit = 0;
  let trim = 0;
  let add = 0;
  let moveStop = 0;
  let review = 0;
  for (const t of triggers) {
    if (t.action === "ENTER") enter++;
    else if (t.action === "EXIT") exit++;
    else if (t.action === "TRIM") trim++;
    else if (t.action === "ADD") add++;
    else if (t.action === "MOVE_STOP") moveStop++;
    else if (t.action === "REVIEW") review++;
  }
  return { enter, exit, trim, add, moveStop, review };
}

async function loadTargets(flags: Flags): Promise<Target[]> {
  const theses = await prisma.thesis.findMany({
    where: {
      status: "ACTIVE",
      direction: { in: ["LONG", "SHORT"] },
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
    orderBy: [
      { researchRun: { agentConfig: { name: "asc" } } },
      { ticker: "asc" },
    ],
  });

  const out: Target[] = [];
  for (const t of theses) {
    const analystName = t.researchRun.agentConfig?.name ?? "(unknown analyst)";
    const existingTriggers = Array.isArray(t.triggers)
      ? (t.triggers as unknown as Trigger[])
      : [];
    out.push({
      thesisId: t.id,
      ticker: t.ticker,
      direction: t.direction as "LONG" | "SHORT",
      horizon: t.horizon as Horizon | null,
      entryPrice: t.entryPrice != null ? Number(t.entryPrice) : null,
      targetPrice: t.targetPrice != null ? Number(t.targetPrice) : null,
      stopLoss: t.stopLoss != null ? Number(t.stopLoss) : null,
      maxHoldDays: t.maxHoldDays ?? null,
      catalystDate: t.catalystDate,
      existingTriggers,
      analystName,
    });
  }
  return out;
}

function buildHeldTriggers(target: Target): Trigger[] | null {
  if (!target.horizon) return null;
  const defaults = defaultTriggersForHorizon(
    target.horizon,
    {
      entryPrice: target.entryPrice,
      targetPrice: target.targetPrice,
      stopLoss: target.stopLoss,
      maxHoldDays: target.maxHoldDays,
      catalystDate: target.catalystDate,
      direction: target.direction,
    },
    "HELD",
  );
  return applyTriggerCooldownDefaults(defaults);
}

function fmtTargets(targets: Target[]): string {
  const lines: string[] = [];
  let lastAnalyst = "";
  for (const t of targets) {
    if (t.analystName !== lastAnalyst) {
      lines.push(`\n▸ ${t.analystName}`);
      lastAnalyst = t.analystName;
    }
    const summary = summarizeTriggers(t.existingTriggers);
    const heldPreview = buildHeldTriggers(t);
    const heldSummary = heldPreview ? summarizeTriggers(heldPreview) : null;
    const horizonLabel = t.horizon ?? "(no horizon)";
    const stopLabel = t.stopLoss != null ? `$${t.stopLoss}` : "—";
    const targetLabel = t.targetPrice != null ? `$${t.targetPrice}` : "—";
    lines.push(
      `    ${t.ticker.padEnd(6)} ${t.direction.padEnd(5)} ${horizonLabel.padEnd(10)}  ` +
        `entry=${t.entryPrice != null ? `$${t.entryPrice}` : "—"}  ` +
        `target=${targetLabel}  stop=${stopLabel}`,
    );
    lines.push(
      `        before:  ENTER=${summary.enter} EXIT=${summary.exit} ` +
        `TRIM=${summary.trim} ADD=${summary.add} MOVE_STOP=${summary.moveStop} ` +
        `REVIEW=${summary.review}`,
    );
    if (heldSummary) {
      lines.push(
        `        after:   ENTER=${heldSummary.enter} EXIT=${heldSummary.exit} ` +
          `TRIM=${heldSummary.trim} ADD=${heldSummary.add} MOVE_STOP=${heldSummary.moveStop} ` +
          `REVIEW=${heldSummary.review}`,
      );
    } else {
      lines.push(
        `        after:   (cannot regenerate — no horizon set; will skip)`,
      );
    }
  }
  return lines.join("\n");
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

type Outcome = {
  thesisId: string;
  ticker: string;
  analystName: string;
  status: "REGENERATED" | "SKIPPED_NO_HORIZON" | "FAILED";
  error?: string;
};

async function regenOne(target: Target): Promise<Outcome> {
  const heldTriggers = buildHeldTriggers(target);
  if (!heldTriggers) {
    console.log(
      `  ⊘ ${target.ticker.padEnd(6)} (${target.analystName}) — no horizon set; skipping`,
    );
    return {
      thesisId: target.thesisId,
      ticker: target.ticker,
      analystName: target.analystName,
      status: "SKIPPED_NO_HORIZON",
    };
  }

  try {
    await prisma.thesis.update({
      where: { id: target.thesisId },
      data: { triggers: heldTriggers as unknown as object },
    });

    await writeThesisUpdate({
      thesisId: target.thesisId,
      type: "UPDATED",
      summary: `Regenerated HELD-template triggers (post-backfill repair, 2026-05-26).`,
      rationale:
        `The 2026-05-26 thesis-research backfill used a thesis-writer prompt that ` +
        `assumed every refresh was for a WATCHING thesis (PR #339's "you are ` +
        `writing a WATCHING thesis" instruction). For ACTIVE theses, the agent ` +
        `dutifully applied the WATCHING template — stripping EXIT predicates ` +
        `and writing ENTER triggers instead. This script regenerated the ` +
        `canonical HELD template via defaultTriggersForHorizon(horizon, prices, ` +
        `"HELD") to restore stop-loss automation. The symmetric Layer-1 guard ` +
        `(reject ENTER-on-ACTIVE, require EXIT-on-ACTIVE) shipped in the same ` +
        `PR prevents future occurrences.`,
      fieldChanges: {
        triggers: {
          from: summarizeTriggers(target.existingTriggers),
          to: summarizeTriggers(heldTriggers),
        },
      },
      runId: null,
    });

    const after = summarizeTriggers(heldTriggers);
    console.log(
      `  ✓ ${target.ticker.padEnd(6)} (${target.analystName}) — ENTER=${after.enter} EXIT=${after.exit} REVIEW=${after.review}`,
    );
    return {
      thesisId: target.thesisId,
      ticker: target.ticker,
      analystName: target.analystName,
      status: "REGENERATED",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      `  ✗ ${target.ticker.padEnd(6)} (${target.analystName}) — ${msg}`,
    );
    return {
      thesisId: target.thesisId,
      ticker: target.ticker,
      analystName: target.analystName,
      status: "FAILED",
      error: msg,
    };
  }
}

function printSummary(outcomes: Outcome[]) {
  const regen = outcomes.filter((o) => o.status === "REGENERATED");
  const skipped = outcomes.filter((o) => o.status === "SKIPPED_NO_HORIZON");
  const failed = outcomes.filter((o) => o.status === "FAILED");

  console.log(`\n=== Regen Summary ===`);
  console.log(`Total:        ${outcomes.length}`);
  console.log(`Regenerated:  ${regen.length}`);
  console.log(`Skipped:      ${skipped.length} (no horizon)`);
  console.log(`Failed:       ${failed.length}`);

  if (failed.length > 0) {
    console.log(`\nFailed (retry via --ticker=X):`);
    for (const o of failed) {
      console.log(
        `  - ${o.ticker.padEnd(6)} (${o.analystName}): ${o.error ?? "unknown error"}`,
      );
    }
  }
  console.log("");
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  const targets = await loadTargets(flags);
  if (targets.length === 0) {
    console.log("No ACTIVE theses found for enabled analyst(s). Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(
    `\nACTIVE-trigger regeneration target list (${targets.length} thesis${
      targets.length === 1 ? "" : "es"
    }):`,
  );
  console.log(fmtTargets(targets));
  console.log("");

  if (flags.dryRun) {
    console.log(
      "DRY RUN — re-run without --dry-run to regenerate triggers.\n",
    );
    await prisma.$disconnect();
    return;
  }

  if (!flags.yes) {
    const ok = await confirm(
      `Proceed with regenerating ${targets.length} thesis trigger array(s)?`,
    );
    if (!ok) {
      console.log("Cancelled.");
      await prisma.$disconnect();
      return;
    }
  }

  console.log(
    `\nRegenerating ${targets.length} thesis${targets.length === 1 ? "" : "es"}...\n`,
  );

  const outcomes: Outcome[] = [];
  for (const t of targets) {
    outcomes.push(await regenOne(t));
  }

  printSummary(outcomes);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("regen-active-triggers failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
