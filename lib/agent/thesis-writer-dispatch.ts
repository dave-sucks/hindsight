// Starting a writer run, once: the watchlist's hand send and the morning's Agent Watch write-ups share it.
// Not "use server" — these take a user and account id, so the browser must never call them.

import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

/** The writer already running on this stock in this account; one RUNNING over 30 minutes is stuck and blocks nothing. */
export async function findInFlightWriter(
  accountId: string,
  ticker: string,
): Promise<{ id: string; agentConfigId: string | null; startedAt: Date } | null> {
  const STUCK_WRITER_AGE_MIN = 30;
  return prisma.researchRun.findFirst({
    where: {
      accountId,
      mode: "THESIS_WRITER",
      status: "RUNNING",
      parameters: { path: ["ticker"], equals: ticker },
      startedAt: {
        gte: new Date(Date.now() - STUCK_WRITER_AGE_MIN * 60 * 1000),
      },
    },
    select: {
      id: true,
      agentConfigId: true,
      startedAt: true,
    },
  });
}

/** Create the writer's run row and fire `app/thesis.write.requested`, the event `dispatch_thesis_research` emits. */
export async function startWriterRun(args: {
  userId: string;
  accountId: string;
  analystId: string;
  environment: "PAPER" | "LIVE";
  ticker: string;
  mode: "mint" | "refresh";
  existingThesisId: string | null;
  /** Lands as a review-clock rung on a mint; a refresh keeps the row's own. */
  reviewCadenceDays: number | null;
  reason: string;
  source: "USER" | "AGENT";
  dispatchedBy: string;
  /** Keep every level the thesis has; fill only the empty ones (a buy placed by hand). */
  keepLevels?: boolean;
}): Promise<{ childRunId: string }> {
  const childRun = await prisma.researchRun.create({
    data: {
      userId: args.userId,
      accountId: args.accountId,
      agentConfigId: args.analystId,
      source: args.source,
      status: "RUNNING",
      // String column, not an enum — same as dispatch_thesis_research.
      mode: "THESIS_WRITER",
      environment: args.environment,
      parameters: {
        ticker: args.ticker,
        mode: args.mode,
        existingThesisId: args.existingThesisId,
        reason: args.reason,
        dispatchedAt: new Date().toISOString(),
        reviewCadenceDays: args.reviewCadenceDays,
        dispatchedBy: args.dispatchedBy,
      } as object,
    },
    select: { id: true },
  });

  await inngest.send({
    name: "app/thesis.write.requested",
    data: {
      childRunId: childRun.id,
      ticker: args.ticker,
      analystId: args.analystId,
      mode: args.mode,
      existingThesisId: args.existingThesisId,
      reason: args.reason,
      parentRunId: null,
      // A name sent this way is coverage to study, never an auto-trade.
      forceWatchingMint: args.mode === "mint",
      promotionContext: null,
      reviewCadenceDays: args.reviewCadenceDays,
      keepLevels: args.keepLevels === true,
    },
  });

  return { childRunId: childRun.id };
}
