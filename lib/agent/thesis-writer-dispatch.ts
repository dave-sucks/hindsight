// Starting a writer run, once: the watchlist's hand send, the morning's write-ups and a no-view watch that came due share it.
// Not "use server" — these take a user and account id, so the browser must never call them.

import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

/** How long a Writer's run counts: one still RUNNING after this is stuck, and one this analyst's finished within it has just written the stock. */
export const WRITER_WINDOW_MIN = 30;

/**
 * The Writer a new one on this stock would repeat: one RUNNING in this account
 * (any analyst's), or, with `analystId`, one of this analyst's that started in
 * the window and finished. A FAILED one blocks nothing; another analyst's
 * finished one blocks nothing (it may write its own thesis). On 2026-11-19 the
 * morning job's Writers for BEEM, CPA and DOYU finished at 08:02, and the
 * Mergers run and its retry sent the three again at 08:02:18 and 08:02:59:
 * the check saw only RUNNING.
 */
export async function findInFlightWriter(
  accountId: string,
  ticker: string,
  analystId?: string | null,
): Promise<{ id: string; agentConfigId: string | null; startedAt: Date; status: string } | null> {
  return prisma.researchRun.findFirst({
    where: {
      accountId,
      mode: "THESIS_WRITER",
      parameters: { path: ["ticker"], equals: ticker },
      startedAt: { gte: new Date(Date.now() - WRITER_WINDOW_MIN * 60 * 1000) },
      OR: [{ status: "RUNNING" }, ...(analystId ? [{ status: "COMPLETE", agentConfigId: analystId }] : [])],
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      agentConfigId: true,
      startedAt: true,
      status: true,
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

/** A write-up that failed this recently waits; under 24h so yesterday's 8 AM failure is tried again this morning. */
const FAILED_WRITEUP_WAIT_MS = 23 * 60 * 60 * 1000;
/** A write-up that completed but left no view waits this long, so a broken one costs one paid retry a week. */
const NO_VIEW_WRITEUP_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A watch with no view has no case to review, so when it comes due code sends
 * it to the Writer, which commits its view, and no run is asked to: the
 * morning job for one with a review clock, the trigger check's run for one
 * whose trigger fired. Not sent, with why, while a Writer is on it or just
 * wrote it, for a week after a write-up that left no view, and for a day
 * after one that failed.
 */
export async function sendNoViewWatch(args: {
  thesisId: string;
  ticker: string;
  analyst: { id: string; accountId: string; userId: string; tradingEnvironment: string };
  reason: string;
  dispatchedBy: string;
}): Promise<{ childRunId: string } | { notSent: string }> {
  const { analyst } = args;
  if (await findInFlightWriter(analyst.accountId, args.ticker, analyst.id)) return { notSent: "a writer is running or just wrote it" };
  const recentRuns = await prisma.researchRun.findMany({
    where: {
      mode: "THESIS_WRITER",
      status: { in: ["COMPLETE", "FAILED"] },
      startedAt: { gte: new Date(Date.now() - NO_VIEW_WRITEUP_WAIT_MS) },
      OR: [
        { parameters: { path: ["existingThesisId"], equals: args.thesisId } },
        { parameters: { path: ["thesisId"], equals: args.thesisId } },
      ],
    },
    select: { status: true, startedAt: true },
    orderBy: { startedAt: "desc" },
  });
  // A write-up that finished and still left no view is broken, not pending: a person looks, and it is paid for again a week on.
  const completed = recentRuns.find((r) => r.status === "COMPLETE");
  if (completed) return { notSent: `written up ${completed.startedAt.toISOString().slice(0, 10)} but no view — needs a look` };
  if (recentRuns.some((r) => r.startedAt.getTime() >= Date.now() - FAILED_WRITEUP_WAIT_MS)) return { notSent: "write-up failed in the last day" };
  return startWriterRun({
    userId: analyst.userId,
    accountId: analyst.accountId,
    analystId: analyst.id,
    environment: analyst.tradingEnvironment as "PAPER" | "LIVE",
    ticker: args.ticker,
    mode: "refresh",
    existingThesisId: args.thesisId,
    reviewCadenceDays: null,
    reason: args.reason,
    source: "AGENT",
    dispatchedBy: args.dispatchedBy,
  });
}
