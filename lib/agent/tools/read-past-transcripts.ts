/**
 * read_past_transcripts — cross-segment continuity for podcast runs.
 *
 * The segment agent already sees its OWN prior briefing as continuity
 * context (threaded into the system prompt). This tool extends that to
 * cover what OTHER segments of the SAME podcast covered in the last
 * 2-3 days, so a Politics segment doesn't re-cover what Sports just
 * mentioned and follow-up arcs span the show.
 *
 * Available only on podcast-segment-run (allowlisted in modes.ts).
 * Resolves the segment's parent podcastId from ctx.podcastSegmentId, then
 * returns recent transcripts across ALL segments under that podcast,
 * each rendered as a generic-kind item with a short snippet.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";

const SNIPPET_CHARS = 400;
const HARD_LIMIT = 12;

export const readPastTranscripts = defineTool({
  description:
    "Read recent transcripts from THIS PODCAST's other segments so you don't repeat them and can build on follow-ups. " +
    "Returns the last lookbackDays (default 3) of transcripts across every segment under this podcast, ordered most-recent first. " +
    "Call ONCE in Stage 1, after read_signals, to ground your editorial choices in what the show has already said.",
  schema: z.object({
    lookbackDays: z
      .number()
      .int()
      .min(1)
      .max(14)
      .optional()
      .describe(
        "How many calendar days back to look. Default 3. Use 7 for weekly shows; rarely worth more.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "research",

  progressLabel: (args) => {
    const days = args.lookbackDays ?? 3;
    return `Reviewing the last ${days}d of this show's transcripts`;
  },

  execute: async ({ lookbackDays = 3 }, ctx) => {
    if (!ctx.podcastSegmentId) {
      return {
        summary: "No segment context — cannot read past transcripts.",
        data: { count: 0, items: [] },
        sources: [],
      };
    }

    // Resolve the parent podcastId from the segment.
    const segment = await prisma.podcastSegment.findUnique({
      where: { id: ctx.podcastSegmentId },
      select: { podcastId: true },
    });
    if (!segment) {
      return {
        summary: "Segment not found.",
        data: { count: 0, items: [] },
        sources: [],
      };
    }

    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    const transcripts = await prisma.segmentTranscript.findMany({
      where: {
        segment: { podcastId: segment.podcastId },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: HARD_LIMIT,
      select: {
        id: true,
        title: true,
        plainText: true,
        createdAt: true,
        segment: { select: { name: true } },
      },
    });

    if (transcripts.length === 0) {
      return {
        summary: `No transcripts in the last ${lookbackDays}d — pick fresh material.`,
        data: {
          count: 0,
          items: [
            {
              kind: "generic" as const,
              text: `No prior episodes in the last ${lookbackDays} day${lookbackDays === 1 ? "" : "s"}. You're free to lead with whatever's strongest today.`,
            },
          ],
        },
        sources: [],
      };
    }

    const items = transcripts.map((t) => {
      const snippet =
        t.plainText.length > SNIPPET_CHARS
          ? `${t.plainText.slice(0, SNIPPET_CHARS).trimEnd()}…`
          : t.plainText;
      const date = t.createdAt.toISOString().slice(0, 10);
      return {
        kind: "generic" as const,
        text: `[${date} · ${t.segment.name}] ${t.title}\n${snippet}`,
      };
    });

    return {
      summary: `${transcripts.length} transcript${transcripts.length === 1 ? "" : "s"} from the last ${lookbackDays}d across this podcast's segments.`,
      data: {
        count: transcripts.length,
        items,
      },
      sources: [],
    };
  },
});
