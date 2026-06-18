import { prisma } from "@/lib/prisma";

/**
 * Shared query for the run-card feed. Both the /runs page and the analyst
 * detail page's Runs tab render the SAME `RunCard`, so they must fetch the same
 * shape — this is the single source for that `include`. The card's title /
 * subtitle / logo stack / realized-P&L all derive from these relations via
 * `buildRunSummary` (lib/run-summary).
 *
 * PRINCIPAL_CHAT rows are chat-session containers, not analytical runs — they're
 * excluded by default (same as /runs) unless a specific `mode` is requested.
 */
export async function fetchRunCardRuns(opts: {
  accountId: string;
  /** Omit to include every environment (the analyst page shows the analyst's
   *  own runs regardless of the global PAPER/LIVE toggle). */
  environment?: "PAPER" | "LIVE";
  /** Scope to one analyst (the analyst detail page). */
  agentConfigId?: string;
  /** Explicit mode filter (the /runs mode dropdown). */
  mode?: string;
  take?: number;
}) {
  const { accountId, environment, agentConfigId, mode, take = 100 } = opts;
  return prisma.researchRun.findMany({
    where: {
      accountId,
      ...(environment ? { environment } : {}),
      mode: mode ?? { not: "PRINCIPAL_CHAT" },
      ...(agentConfigId ? { agentConfigId } : {}),
    },
    include: {
      agentConfig: { select: { id: true, name: true } },
      segment: {
        select: {
          id: true,
          name: true,
          podcast: { select: { id: true, name: true } },
        },
      },
      segmentTranscript: {
        select: { title: true, durationSec: true, citations: true },
      },
      theses: {
        select: { ticker: true, direction: true, scoring: true },
        orderBy: { createdAt: "asc" },
      },
      decisions: {
        select: {
          symbol: true,
          decision: true,
          position: {
            select: { realizedPnl: true, outcome: true, status: true },
          },
        },
      },
      managementActions: {
        select: {
          actionType: true,
          prevStopLoss: true,
          newStopLoss: true,
          prevTargetPrice: true,
          newTargetPrice: true,
          prevTrailPct: true,
          newTrailPct: true,
          position: { select: { symbol: true } },
        },
      },
      thesisUpdates: {
        select: {
          type: true,
          summary: true,
          thesis: { select: { ticker: true, status: true } },
        },
      },
    },
    orderBy: { startedAt: "desc" },
    take,
  });
}

/** One run row in the shape `RunCard` expects. */
export type RunCardRun = Awaited<ReturnType<typeof fetchRunCardRuns>>[number];
