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
 *   24 theses, 43 mints:
 *     19 watchlist floors + 19 watchlist targets  <- no money on any of them
 *      0 watchlist buy levels (all 19 already have one)
 *      0 held floors        <- no new sell on any live position
 *      5 held targets, as REVIEW
 *
 *   Plus 1 stale-level move: MU's Target slot is held by a $934 review the
 *   agent wrote on 8/18 when the floor was $814. The column says $1,100.
 *   Moving it also clears the 935/934 straddle, since nothing sits at $934
 *   afterwards.
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
    // Rungs this build can no longer PARSE are carried through verbatim.
    // A backfill must never be the thing that deletes a trigger: the parser
    // drops what it can't read (correctly — one bad rung must not take down a
    // ladder), but writing the parsed list back makes that drop permanent.
    // Right now that would silently delete two live PRICE_MOVE_PCT rungs on
    // MU, casualties of removing the 5D window. They never fired and are
    // being cleaned up deliberately elsewhere; they do not die here.
    const rawArr: unknown[] = Array.isArray(t.triggers) ? t.triggers : [];
    const stored = parseTriggersResilient(t.triggers).triggers as Trigger[];
    const keptIds = new Set(stored.map((x) => x.id));
    const unreadable = rawArr.filter(
      (x) =>
        x && typeof x === "object" && !keptIds.has((x as { id?: string }).id ?? ""),
    );
    // Resolve so an inherited floor counts as already-armed — we must not
    // stamp a thesis-level copy of a rule that lives on the account.
    const resolvedLadder = resolveThesisLadder(
      t,
      sources.get(t.researchRun?.agentConfigId ?? ""),
      `thesis=${t.id}`,
    );
    const inherited = resolvedLadder.filter((r) => r.inherited);

    const before = applyLevelArgs({
      stored, inherited, levels: {}, direction: t.direction,
      status: t.status, mintId: () => randomUUID(),
    }).columns;

    // A slot needs the column armed when nothing occupies it — or when what
    // DOES occupy it sits at a different price and wasn't put there by hand.
    //
    // The empty case is the bulk of it. The mismatch case exists because of
    // MU: its Target slot is filled by a $934 review the agent wrote on 8/18
    // as an "it recovered, look again" checkpoint, while the column says
    // $1,100. Treating that as coverage is circular — it excludes the row on
    // the strength of the very trigger that is wrong. The card would read
    // "Target $934" on a stock trading near $926.
    //
    // A PRINCIPAL-sourced trigger always wins over the column: a level set by
    // hand is intent, a column is a stale cache, and this script must never
    // move a number someone chose.
    const occupantSource = (slot: "FLOOR" | "TARGET") =>
      stored.find(
        (x) =>
          (x.predicate.kind === "PRICE_BELOW" || x.predicate.kind === "PRICE_ABOVE") &&
          (slot === "FLOOR"
            ? x.action === "EXIT" && x.predicate.kind === (t.direction === "SHORT" ? "PRICE_ABOVE" : "PRICE_BELOW")
            : (x.action === "EXIT" || x.action === "REVIEW") &&
              x.predicate.kind === (t.direction === "SHORT" ? "PRICE_BELOW" : "PRICE_ABOVE")),
      )?.source;

    const needs = (
      slot: "FLOOR" | "TARGET",
      derived: number | null,
      column: number | null,
    ): number | undefined => {
      if (column == null) return undefined;
      if (derived == null) return column; // empty slot
      if (Math.abs(derived - column) < 0.005) return undefined; // already right
      if (occupantSource(slot) === "PRINCIPAL") return undefined; // hands off
      return column; // stale occupant — move it to the intended level
    };

    const levels = {
      floor: needs("FLOOR", before.stopLoss, t.stopLoss),
      target: needs("TARGET", before.targetPrice, t.targetPrice),
      // A buy level is only missing when there is NO way in at all. GD, GEV
      // and VST each carry a deliberate non-price entry — an AND composite,
      // an earnings beat, a moving-average reclaim. `before.entryPrice` is
      // null for those because the card needs a PRICE, but minting one
      // alongside would give three watchlist names two contradictory ways in.
      // An analyst who chose "buy on the beat" did not ask for "also buy at
      // $340".
      // A buy level is only missing when there is NO way in at all — and
      // even then only the TRIGGER is minted; the column above is left alone.
      entry:
        t.status === "WATCHING" &&
        t.entryPrice != null &&
        !stored.some((x) => x.action === "ENTER") &&
        !inherited.some((x) => x.action === "ENTER")
          ? t.entryPrice
          : undefined,
    };
    const mints = Object.entries(levels).filter(([, v]) => v !== undefined);
    if (mints.length === 0) continue;

    changed++;
    const plan = mints
      .map(([slot, v]) => {
        const verb = slot === "floor" ? "sell below" : slot === "target" ? "review above" : "buy at";
        const occupied =
          slot === "floor" ? before.stopLoss != null : slot === "target" ? before.targetPrice != null : false;
        const from = slot === "floor" ? before.stopLoss : before.targetPrice;
        // Say when a level MOVES rather than appears — that is a different
        // kind of change and it should not read the same in the log.
        return occupied ? `${verb} $${from} -> $${v} (stale)` : `${verb} $${v}`;
      })
      .join(", ");
    console.log(
      `${APPLY ? "ARM " : "plan"}  ${t.status.padEnd(8)} ${t.ticker.padEnd(6)} ${plan}` +
        (unreadable.length ? `  [carrying ${unreadable.length} unreadable rung(s) through untouched]` : ""),
    );
    if (!APPLY) continue;

    const applied = applyLevelArgs({
      stored, inherited, levels, direction: t.direction, status: t.status,
      // DEFAULT, not PRINCIPAL. PRINCIPAL means "the principal chose this
      // number": it tells the agent to honour the level and not re-propose
      // against it, and it exempts the level from the protective ratchet.
      // The first run signed 43 machine-generated levels with a name that
      // did not author them. Re-stamped in the database by hand.
      source: "DEFAULT", mintId: () => randomUUID(),
    });
    await prisma.thesis.update({
      where: { id: t.id },
      data: {
        triggers: [...applied.triggers, ...unreadable] as unknown as object[],
        targetPrice: applied.columns.targetPrice,
        stopLoss: applied.columns.stopLoss,
        // entryPrice is NEVER written here. It is what you paid, or your
        // target buy price — authored intent either way. The first run
        // rewrote it from whatever the buy TRIGGER said, which changed four
        // of them (ABT 96->98, ETN 391.39->380, MSFT 418.57->520, NOW
        // 110->130) and NULLED three more (GD, GEV, VST) whose buy trigger
        // isn't a price at all but an earnings beat, a moving-average
        // reclaim, and a composite.
        //
        // MSFT is the one that shows why it matters: its stored plan was buy
        // $418.57 / target $500, perfectly coherent. Taking the trigger's
        // $520 manufactured a target BELOW the buy level — a broken plan
        // that neither store held before the backfill touched it, and that
        // would then have cleared itself on the first tick. All seven
        // restored by hand.
      },
      // Return the id only. Prisma otherwise SELECTs every column back, and
      // this branch's client knows about columns (lastReviewedAt) that
      // production will not have until the L7 migration deploys — the update
      // itself is fine, reading the row back is not.
      select: { id: true },
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
