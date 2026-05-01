/**
 * podcast-segment-run — Inngest function for server-side segment execution.
 *
 * Triggered by `podcast/segment.run.requested` (fired by `runSegmentViaInngest`
 * server action, which is what "Run all" uses). Mirrors morning-research.ts
 * exactly — generateText server-side, no browser required.
 *
 * The individual per-segment "Run" button still uses the browser AgentThread
 * path (source=MANUAL). "Run all" fires this path (source=AGENT) so all
 * segments execute in parallel without requiring the user to navigate anywhere.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { buildPodcastSegmentRunPrompt } from "@/lib/podcast/segment-run-prompt";
import { MODES } from "@/lib/agent/modes";

const MODE = MODES["podcast-segment-run"];
const ALLOWLIST = new Set(MODE.toolAllowlist ?? []);

export const podcastSegmentRun = inngest.createFunction(
  {
    id: "podcast-segment-run",
    name: "Podcast Segment Run (server-side)",
    retries: 1,
  },
  { event: "podcast/segment.run.requested" },
  async ({ event, step }) => {
    const { segmentId, runId, userId } = event.data as {
      segmentId: string;
      runId: string;
      userId: string;
    };

    await step.run("run-segment", async () => {
      const t0 = Date.now();

      // ── Load segment + podcast ─────────────────────────────────────────────
      const segment = await prisma.podcastSegment.findFirst({
        where: { id: segmentId, userId },
        include: { podcast: true },
      });
      if (!segment) throw new Error(`Segment ${segmentId} not found for user ${userId}`);

      // ── Continuity context ─────────────────────────────────────────────────
      const lastTranscript = await prisma.segmentTranscript.findFirst({
        where: { segmentId },
        orderBy: { createdAt: "desc" },
        select: { title: true },
      });

      let priorBriefing: {
        narrative: string;
        followUps: unknown;
        generatedAt: Date;
      } | null = null;
      try {
        priorBriefing = await prisma.podcastSegmentBriefing.findFirst({
          where: { segmentId },
          orderBy: { generatedAt: "desc" },
          select: { narrative: true, followUps: true, generatedAt: true },
        });
      } catch {
        // Migration lag — continue without briefing
      }

      // ── System prompt ──────────────────────────────────────────────────────
      const systemPrompt = buildPodcastSegmentRunPrompt({
        podcast: {
          name: segment.podcast.name,
          description: segment.podcast.description,
          hostStyle: segment.podcast.hostStyle,
          cadence: segment.podcast.cadence,
        },
        segment: {
          name: segment.name,
          description: segment.description,
          segmentPrompt: segment.segmentPrompt,
          targetSeconds: segment.targetSeconds,
          topics: segment.topics,
          excludeTopics: segment.excludeTopics,
        },
        lastTranscriptTitle: lastTranscript?.title ?? null,
        priorBriefing: priorBriefing
          ? {
              narrative: priorBriefing.narrative,
              followUps: Array.isArray(priorBriefing.followUps)
                ? (priorBriefing.followUps as Array<{
                    topic: string;
                    why: string;
                    priority: "HIGH" | "NORMAL";
                  }>)
                : [],
              generatedAt: priorBriefing.generatedAt,
            }
          : null,
      });

      // ── Tools ──────────────────────────────────────────────────────────────
      const allTools = createResearchTools({
        runId,
        userId,
        podcastSegmentId: segmentId,
        watchlist: [],
        positionTickers: [],
        exclusionList: [],
        sectors: [],
        industries: [],
        themes: [],
        marketCapMin: null,
        marketCapMax: null,
      });
      const tools = Object.fromEntries(
        Object.entries(allTools).filter(([name]) => ALLOWLIST.has(name)),
      );

      // ── Run agent ──────────────────────────────────────────────────────────
      console.log(
        `[podcast-segment-run] Starting generateText segmentId=${segmentId} runId=${runId} systemPrompt=${systemPrompt.length}chars`,
      );

      let response: Awaited<ReturnType<typeof generateText>>["response"];
      try {
        const result = await generateText({
          model: openai("gpt-4o"),
          system: systemPrompt,
          prompt: "Begin researching and writing this segment now.",
          tools,
          stopWhen: stepCountIs(MODE.maxSteps),
          abortSignal: AbortSignal.timeout(210_000), // 3.5 min — leaves buffer before Inngest step limit
        });
        response = result.response;

        console.log(
          `[podcast-segment-run] generateText done in ${Date.now() - t0}ms steps=${result.steps.length}`,
        );
      } catch (err) {
        const isTimeout =
          err instanceof Error &&
          (err.name === "AbortError" ||
            err.message.includes("aborted") ||
            err.message.includes("timed out"));
        console.error(
          `[podcast-segment-run] Agent ${isTimeout ? "TIMED OUT" : "FAILED"}: ${err instanceof Error ? err.message : err}`,
        );
        // Safety: mark RUNNING → FAILED (complete_run may not have fired)
        await prisma.researchRun.updateMany({
          where: { id: runId, status: "RUNNING" },
          data: { status: "FAILED", completedAt: new Date() },
        });
        throw err;
      }

      // ── Persist messages ───────────────────────────────────────────────────
      try {
        const userMessage = {
          role: "user",
          content: [{ type: "text", text: "Begin researching and writing this segment now." }],
        };
        const allMessages = [userMessage, ...(response?.messages ?? [])];
        await prisma.$transaction(async (tx) => {
          await tx.runMessage.deleteMany({ where: { runId } });
          await tx.runMessage.create({
            data: { runId, role: "thread", content: JSON.stringify(allMessages) },
          });
        });
        console.log(`[podcast-segment-run] Persisted ${allMessages.length} messages for run ${runId}`);
      } catch (err) {
        console.error(`[podcast-segment-run] Failed to persist messages:`, err);
      }

      // ── Safety: mark RUNNING → COMPLETE if complete_run didn't ────────────
      await prisma.researchRun.updateMany({
        where: { id: runId, status: "RUNNING" },
        data: { status: "COMPLETE", completedAt: new Date() },
      });

      return { segmentId, runId, elapsedMs: Date.now() - t0 };
    });

    return { segmentId, runId };
  },
);
