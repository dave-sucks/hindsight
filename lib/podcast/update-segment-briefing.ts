/**
 * Post-segment-run briefing agent.
 *
 * Mirror of lib/agent/update-analyst-briefing.ts but simpler — segments
 * don't have portfolio state, just a recap of what was covered + follow-
 * ups for the next episode. Reads the run's transcript + recent run
 * events and asks GPT-4o-mini for a 200-300 word standup.
 *
 * Called from complete_run's segment branch. Non-fatal — errors are
 * logged but don't break the run.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const briefingSchema = z.object({
  narrative: z
    .string()
    .describe(
      "200-300 word recap of what this segment covered this run. Markdown allowed. Mention specific stories, sources, and angles taken so the next run knows what's already been said.",
    ),
  followUps: z
    .array(
      z.object({
        topic: z
          .string()
          .describe("Specific story/angle to follow up on next episode."),
        why: z.string().describe("Why this matters — what's still open."),
        priority: z.enum(["HIGH", "NORMAL"]),
      }),
    )
    .describe(
      "0-5 follow-up items. Empty array if everything wrapped cleanly.",
    ),
});

interface BriefingContext {
  segmentId: string;
  runId: string;
  userId: string;
  accountId: string;
}

export async function updateSegmentBriefing({
  segmentId,
  runId,
  userId,
  accountId,
}: BriefingContext): Promise<void> {
  if (!segmentId || !runId || !userId) {
    console.warn(
      `[segment-briefing] missing input segmentId=${segmentId} runId=${runId} userId=${userId}`,
    );
    return;
  }

  try {
    const t0 = Date.now();

    const [segment, transcript, recentEvents, recentBriefings] =
      await Promise.all([
        prisma.podcastSegment.findUnique({
          where: { id: segmentId },
          select: {
            name: true,
            description: true,
            segmentPrompt: true,
            topics: true,
            podcast: { select: { name: true, hostStyle: true } },
          },
        }),
        prisma.segmentTranscript.findUnique({
          where: { runId },
          select: {
            title: true,
            plainText: true,
            citations: true,
            durationSec: true,
          },
        }),
        prisma.runEvent.findMany({
          where: { runId },
          orderBy: { createdAt: "asc" },
          select: { type: true, title: true, message: true },
          take: 30,
        }),
        // Last 3 prior briefings on this segment, for continuity context.
        prisma.podcastSegmentBriefing.findMany({
          where: { segmentId, NOT: { runId } },
          orderBy: { generatedAt: "desc" },
          take: 3,
          select: { narrative: true, followUps: true, generatedAt: true },
        }),
      ]);

    if (!segment) {
      console.warn(`[segment-briefing] segment ${segmentId} not found`);
      return;
    }

    const transcriptSnippet = transcript
      ? `Title: ${transcript.title}\nDuration: ~${transcript.durationSec ?? "?"}s\nCitations: ${
          Array.isArray(transcript.citations)
            ? (transcript.citations as unknown[]).length
            : 0
        }\n\n${transcript.plainText.slice(0, 2400)}${transcript.plainText.length > 2400 ? "..." : ""}`
      : "(No transcript was written for this run.)";

    const eventsBlock = recentEvents
      .map((e) => `- ${e.type}: ${e.title}${e.message ? ` — ${e.message.slice(0, 120)}` : ""}`)
      .join("\n");

    const priorBlock =
      recentBriefings.length === 0
        ? "(No prior briefings yet — this is the segment's first or second run.)"
        : recentBriefings
            .map(
              (b, i) =>
                `### Brief ${recentBriefings.length - i} (${b.generatedAt.toISOString().slice(0, 10)})\n${b.narrative.slice(0, 600)}`,
            )
            .join("\n\n");

    const prompt = `You are the Segment Standup Writer for Hindsight's podcast platform. After every segment run you write a short briefing the next run will read for continuity.

## Show
${segment.podcast.name}${segment.podcast.hostStyle ? ` — ${segment.podcast.hostStyle}` : ""}

## Segment
Name: ${segment.name}
${segment.description ? `Description: ${segment.description}\n` : ""}Topics: ${segment.topics.join(", ") || "(open)"}
Editorial brief:
${segment.segmentPrompt}

## What this run produced
Transcript:
${transcriptSnippet}

Recent run events:
${eventsBlock || "(none)"}

## Prior briefings on this segment
${priorBlock}

## Your task
Write a 200-300 word narrative recap of WHAT THIS SEGMENT COVERED THIS RUN — specific stories, the angle taken, sources cited. The point is the next run reads this and knows what NOT to repeat.

Then list 0-5 follow-ups: open threads, expected next-episode catalysts, things that didn't fit this episode but should be revisited. Empty array is valid if everything wrapped cleanly.

Be concrete. The next run will quote this.`;

    let object: z.infer<typeof briefingSchema>;
    try {
      const result = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: briefingSchema,
        prompt,
      });
      object = result.object;
    } catch (genErr) {
      console.error(
        `[segment-briefing] generateObject FAILED for run=${runId}:`,
        genErr instanceof Error ? genErr.message : genErr,
      );
      // Fallback so we still write a row — keeps continuity working
      // even when the LLM call fails.
      object = {
        narrative: transcript
          ? `Run ${new Date().toISOString().slice(0, 10)}: produced segment "${transcript.title}" (~${transcript.durationSec ?? "?"}s, ${
              Array.isArray(transcript.citations)
                ? (transcript.citations as unknown[]).length
                : 0
            } citations). LLM briefing fell back — see Vercel logs for the underlying error.`
          : `Run ${new Date().toISOString().slice(0, 10)}: completed without writing a transcript. LLM briefing fell back.`,
        followUps: [],
      };
    }

    await prisma.podcastSegmentBriefing.upsert({
      where: { runId },
      create: {
        segmentId,
        runId,
        userId,
        accountId,
        narrative: object.narrative,
        followUps: object.followUps as object,
      },
      update: {
        narrative: object.narrative,
        followUps: object.followUps as object,
        generatedAt: new Date(),
      },
    });

    console.log(
      `[segment-briefing] persisted run=${runId} segment=${segmentId} in ${Date.now() - t0}ms`,
    );
  } catch (err) {
    console.error(
      `[segment-briefing] FAILED run=${runId} segment=${segmentId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
