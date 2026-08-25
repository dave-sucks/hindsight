/**
 * Setting a plan down — the write behind DEMOTE.
 *
 * > Design: docs/plans/LEVELS_AS_TRIGGERS.md (L5).
 *
 * Demotion drops the priced plan from a watch item and keeps watching it:
 * the buy level, the floor and the target go, the cached columns recompute
 * to null, and the thesis stays WATCHING with whatever else it carries
 * (review cadence, earnings triggers, the belief itself).
 *
 * Two callers, one write:
 *
 *   automatic — a floor or target fires on a thesis we don't own. The floor
 *     breaking means the plan's premise is wrong; the target being reached
 *     means the move happened without us. Either way the numbers are stale.
 *     (`effectiveTriggerAction` in ./types picks this.)
 *
 *   on demand — a person or an agent decides a name isn't worth a priced
 *     plan right now. That is DAV-209's demotion, described there as "null
 *     out entry/stop/target, keep the item and its triggers." Same end
 *     state; under this model the way to null those columns is to remove the
 *     triggers behind them, never to write the columns.
 *
 * Why it needs no approval: nothing is bought or sold and no protection is
 * removed from a live position — demotion only ever runs on a thesis with no
 * open position. It is the cheap move that was missing, which is why KLAC sat
 * mispriced for two months instead of being set down.
 *
 * Flagged, not silent: the write leaves a TRIGGER_FIRED row, so the thesis
 * surfaces on the next daily run with `needsAction` set and the analyst
 * re-underwrites it. Clearing the numbers without telling anyone would be its
 * own version of the KLAC failure.
 */

import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { parseTriggersResilient } from "./schema";
import type { Trigger } from "./types";
import { isPlanLevel } from "./price-levels";

export { isPlanLevel };

export interface DemoteResult {
  /** False when the thesis was already unpriced — nothing to do. */
  demoted: boolean;
  /** The levels that were dropped, for the audit line. */
  removed: Array<{ action: string; price: number }>;
}

/**
 * Drop the priced plan from a WATCHING thesis. Idempotent: a thesis carrying
 * no plan levels returns `demoted: false` and writes nothing, so a repeated
 * fire can't spam the activity log.
 */
export async function demoteThesisPlan(args: {
  thesisId: string;
  /** Why — goes into the audit row the daily run reads. */
  reason: string;
  /** The trigger whose fire caused this, when it was automatic. */
  triggerId?: string | null;
  runId?: string | null;
  priceAtTime?: number | null;
}): Promise<DemoteResult> {
  const thesis = await prisma.thesis.findUnique({
    where: { id: args.thesisId },
    select: { id: true, ticker: true, direction: true, status: true, triggers: true },
  });
  if (!thesis) return { demoted: false, removed: [] };

  // Never on a live position. A floor breach on something we OWN is a sell,
  // and stripping its protection instead would be the worst possible read of
  // this function. `effectiveTriggerAction` already guarantees it, but this
  // is the write — it does not get to assume its caller was correct.
  if (thesis.status !== "WATCHING") return { demoted: false, removed: [] };

  const current = parseTriggersResilient(thesis.triggers).triggers as Trigger[];
  const doomed = current.filter((t) => isPlanLevel(t, thesis.direction));
  if (doomed.length === 0) return { demoted: false, removed: [] };

  const kept = current.filter((t) => !isPlanLevel(t, thesis.direction));
  const removed = doomed.map((t) => ({
    action: t.action,
    price:
      t.predicate.kind === "PRICE_ABOVE" || t.predicate.kind === "PRICE_BELOW"
        ? t.predicate.level
        : 0,
  }));

  await prisma.thesis.update({
    where: { id: thesis.id },
    data: {
      triggers: kept as unknown as object[],
      // The columns are a cache of the triggers we just removed.
      entryPrice: null,
      targetPrice: null,
      stopLoss: null,
    },
  });

  await writeThesisUpdate({
    thesisId: thesis.id,
    // TRIGGER_FIRED (not UPDATED) so the thesis surfaces with needsAction set
    // on the next daily run — demotion is the start of a re-underwrite, not
    // the end of one.
    type: "TRIGGER_FIRED",
    summary: `${thesis.ticker} plan set down — ${args.reason}`,
    rationale:
      `The priced plan on ${thesis.ticker} was removed: ` +
      removed.map((r) => `${r.action.toLowerCase()} at $${r.price}`).join(", ") +
      `. ${args.reason} Still watching — re-price it if the setup comes back, ` +
      `or stop watching if it doesn't.`,
    triggerId: args.triggerId ?? undefined,
    signalIds: [],
    runId: args.runId ?? null,
    priceAtTime: args.priceAtTime ?? null,
    fieldChanges: {
      entryPrice: { from: null, to: null },
      triggers: { from: `${current.length} triggers`, to: `${kept.length} triggers` },
    },
  });

  return { demoted: true, removed };
}
