"use server";

import { prisma } from "@/lib/prisma";
import type { RunEvent, RunMessage } from "@/lib/generated/prisma/client";

/**
 * Returns RunEvents for a run. If the run is COMPLETE but has no events
 * (predates streaming), synthesizes a minimal set of events and persists
 * them so the timeline renders something useful.
 *
 * Synthetic events represent only what we know happened — they do NOT
 * fabricate reasoning or intermediate steps.
 */
export async function getOrSynthesizeRunEvents(
  runId: string,
  userId: string
): Promise<RunEvent[]> {
  // Verify ownership
  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      theses: {
        include: { trade: { select: { id: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!run) return [];

  // Real events exist — return them
  if (run.events.length > 0) {
    return run.events;
  }

  // Run is still in progress or has no theses — nothing to synthesize
  if (run.status !== "COMPLETE" || run.theses.length === 0) {
    return [];
  }

  // Synthesize minimal events from what we know
  const now = run.completedAt ?? run.updatedAt;
  const startedAt = run.startedAt;

  const eventsToCreate = [
    {
      runId,
      type: "run.started",
      title: "Research run started",
      createdAt: startedAt,
    },
    {
      runId,
      type: "discovery.completed",
      title: `${run.theses.length} ticker${run.theses.length !== 1 ? "s" : ""} researched`,
      payload: {
        candidates: run.theses.map((t) => ({ ticker: t.ticker })),
        synthetic: true,
      },
      createdAt: new Date(startedAt.getTime() + 1000),
    },
    ...run.theses.map((thesis, i) => ({
      runId,
      type: "thesis.generated",
      title: `${thesis.ticker}: ${thesis.direction} @ ${thesis.confidenceScore}% confidence`,
      payload: {
        ticker: thesis.ticker,
        direction: thesis.direction,
        confidence: thesis.confidenceScore,
        synthetic: true,
      },
      createdAt: new Date(startedAt.getTime() + 2000 + i * 500),
    })),
    ...run.theses
      .filter((t) => t.trade != null)
      .map((thesis, i) => ({
        runId,
        type: "trade.executed",
        title: `Trade placed: ${thesis.ticker} ${thesis.direction}`,
        payload: {
          ticker: thesis.ticker,
          tradeId: thesis.trade!.id,
          synthetic: true,
        },
        createdAt: new Date(
          startedAt.getTime() + 2000 + run.theses.length * 500 + i * 200
        ),
      })),
    {
      runId,
      type: "run.completed",
      title: `Run complete — ${run.theses.length} theses generated`,
      createdAt: now,
    },
  ];

  // Persist synthesized events (createMany is faster but doesn't return rows)
  await prisma.runEvent.createMany({ data: eventsToCreate });

  // Return persisted events in order
  return prisma.runEvent.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Returns RunMessages for a run (for run-scoped chat history).
 */
export async function getRunMessages(
  runId: string,
  userId: string
): Promise<RunMessage[]> {
  // Verify ownership
  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId },
    select: { id: true },
  });

  if (!run) return [];

  return prisma.runMessage.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });
}
