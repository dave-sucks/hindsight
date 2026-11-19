/**
 * mint-watch.ts — a stock on an analyst's watch with no view and no
 * playbook, as the owner's add: the watchlist's add (addWatchlistItem) and
 * the chat's watch_stock both write it here. It belongs to the analyst's
 * manual run, carries the reason as its note, and one CREATED line.
 */
import { prisma } from "@/lib/prisma";
import { getOrCreateManualRun } from "@/lib/agent/manual-run-anchor";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

export interface MintWatchArgs {
  analystId: string;
  userId: string;
  accountId: string;
  ticker: string;
  reason: string;
  sourceKind: "USER_ADDED" | "BUILDER_SEED" | "WATCHLIST_REVIEW";
  /** The watch's first triggers; none, and nothing wakes it until one is added. */
  triggers?: object[];
  /** The stock's event date, when its look-again counts from it (watch_stock). */
  catalystDate?: Date;
  /** The CREATED line's title. */
  summary: string;
}

export async function mintWatch(a: MintWatchArgs) {
  const runId = await getOrCreateManualRun({ analystId: a.analystId, userId: a.userId, accountId: a.accountId });
  const thesis = await prisma.thesis.create({
    data: {
      researchRunId: runId,
      userId: a.userId,
      accountId: a.accountId,
      ticker: a.ticker.toUpperCase(),
      source: "MANUAL",
      // No view yet: direction null, a watch.
      direction: null,
      status: "WATCHING",
      holdDuration: "SWING",
      snapshot: { text: a.reason || "Added manually — awaiting first research", citations: [] },
      modelUsed: "manual",
      sourceKind: a.sourceKind,
      sourceRationale: a.reason || "Manual watchlist add",
      triggers: (a.triggers ?? []) as object[],
      ...(a.catalystDate ? { catalystDate: a.catalystDate } : {}),
    },
  });
  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "CREATED",
    summary: a.summary,
    fieldChanges: { status: { from: null, to: thesis.status } },
    runId,
  });
  return thesis;
}
