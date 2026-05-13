/**
 * Manual ResearchRun anchor — per-analyst, long-lived synthetic run that
 * anchors manually-minted Theses to a ResearchRun (the FK is required).
 *
 * Manual UI clicks ("Add Stock to Watchlist") and other non-agent watchlist
 * writes don't have a natural ResearchRun context. Rather than make
 * `Thesis.researchRunId` nullable (which would weaken an invariant the
 * trade evaluator + run-summary pipeline rely on), we use a synthetic
 * per-analyst run with id `manual-<analystId>`. The first manual write
 * per analyst creates it; everything after upserts.
 *
 * See docs/WATCHLIST_COLLAPSE_PLAN.md → Open question #1 (resolved 2026-05-13).
 *
 * Shape conventions:
 *   id          = `manual-<analystId>` (deterministic, idempotent upsert)
 *   source      = "MANUAL"
 *   status      = "COMPLETE" (the run isn't "running" anything; it's an
 *                  anchor row. COMPLETE so it doesn't appear in any
 *                  in-progress run filters.)
 *   mode        = "MANUAL"
 *   environment = matches the analyst's tradingEnvironment at creation.
 */

import { prisma } from "@/lib/prisma";

/**
 * Returns the ResearchRun.id that manual-add theses should anchor to for
 * a given analyst. Creates the row if it doesn't exist (idempotent).
 *
 * Throws if the analyst doesn't exist or the caller's userId/accountId
 * doesn't match the analyst's userId/accountId.
 */
export async function getOrCreateManualRun(args: {
  analystId: string;
  userId: string;
  accountId: string;
}): Promise<string> {
  const { analystId, userId, accountId } = args;
  const manualRunId = `manual-${analystId}`;

  // Fast path — the row almost always exists after the first manual add.
  const existing = await prisma.researchRun.findUnique({
    where: { id: manualRunId },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Cold path — create the anchor row. Wrapped in a try/catch because two
  // concurrent manual-add clicks on a fresh analyst could race here; the
  // unique-id constraint guarantees only one row exists, the loser falls
  // through and reads the winner's row.
  try {
    const run = await prisma.researchRun.create({
      data: {
        id: manualRunId,
        userId,
        accountId,
        agentConfigId: analystId,
        source: "MANUAL",
        status: "COMPLETE",
        mode: "MANUAL",
        environment: "PAPER",
        parameters: {
          note: "Synthetic anchor for manual watchlist adds; see lib/agent/manual-run-anchor.ts",
        },
        completedAt: new Date(),
      },
      select: { id: true },
    });
    return run.id;
  } catch {
    // Lost the race or hit a constraint — re-fetch.
    const refetch = await prisma.researchRun.findUnique({
      where: { id: manualRunId },
      select: { id: true },
    });
    if (refetch) return refetch.id;
    throw new Error(
      `Failed to create or find manual ResearchRun anchor for analyst ${analystId}`,
    );
  }
}
