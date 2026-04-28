/**
 * write_segment_transcript — Stage 5 of a podcast-segment-run.
 *
 * The analog of record_thesis for podcast segment runs. Persists a
 * SegmentTranscript row tied to (runId, segmentId) and returns a
 * tool-ui result so the chat shows a preview of the script + citation
 * count. Audio is left null in Phase 1; Phase 2 adds ElevenLabs TTS
 * via either a follow-up tool or post-processing on this row.
 *
 * See docs/PODCAST_PLAN.md.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";

const citationSchema = z.object({
  claim: z
    .string()
    .min(4)
    .describe(
      "The factual claim being cited, in the form spoken in the transcript.",
    ),
  url: z
    .string()
    .url()
    .describe("URL of the source backing this claim."),
  quote: z
    .string()
    .optional()
    .describe(
      "Verbatim quote from the source supporting the claim — short, exact.",
    ),
  startChar: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Index in plainText where the claim starts. Used for inline citation chips and karaoke.",
    ),
  endChar: z
    .number()
    .int()
    .nonnegative()
    .describe("Index in plainText where the claim ends."),
  signalId: z
    .string()
    .optional()
    .nullable()
    .describe(
      "If this claim came from a signal returned by read_signals, its signalId. Otherwise null/omit.",
    ),
  artifactId: z
    .string()
    .optional()
    .nullable()
    .describe(
      "If this claim came from an artifact returned by read_artifact, its artifactId. Otherwise null/omit.",
    ),
});

const transcriptSchema = z
  .object({
    title: z
      .string()
      .min(4)
      .describe(
        "Episode-specific segment title (e.g. 'Anthropic's $5B raise and the new compute math'). NOT the segment NAME from config.",
      ),
    plainText: z
      .string()
      .min(50)
      .describe(
        "Final spoken script. No markdown, no headings, no [1] citation markers — citations live in the citations array.",
      ),
    ssml: z
      .string()
      .optional()
      .describe(
        "Optional SSML version with prosody hints. Phase 2 — leave empty for now if uncertain.",
      ),
    durationSec: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Estimated spoken duration. Optional; computed from word count if omitted.",
      ),
    citations: z
      .array(citationSchema)
      .min(1)
      .describe(
        "Every factual claim in plainText must be cited. Empty arrays are rejected.",
      ),
  })
  .superRefine((val, ctx) => {
    // Cross-check citation char ranges against plainText length.
    const len = val.plainText.length;
    for (let i = 0; i < val.citations.length; i++) {
      const c = val.citations[i];
      if (c.startChar > len || c.endChar > len) {
        ctx.addIssue({
          code: "custom",
          message: `citations[${i}] has startChar=${c.startChar} endChar=${c.endChar} but plainText is only ${len} chars long.`,
          path: ["citations", i],
        });
      }
      if (c.endChar < c.startChar) {
        ctx.addIssue({
          code: "custom",
          message: `citations[${i}] has endChar < startChar.`,
          path: ["citations", i],
        });
      }
    }
  });

const APPROX_WORDS_PER_SECOND = 150 / 60;

export const writeSegmentTranscript = defineTool({
  description:
    "STAGE 3. Write the final segment transcript and persist it. The plainText field is the spoken script; citations[] documents every factual claim. Call this exactly once per run, then call complete_run.",
  schema: transcriptSchema,
  // Renders inline via TranscriptCardRenderer — clickable card opening a
  // Sheet with the full transcript + citation chips. Mirror of how
  // record_thesis renders inline as a ThesisCard. See
  // components/domain/transcript-card.tsx.
  ui: "transcript-card" as const,

  progressLabel: (args) => `Writing the script: ${args.title.slice(0, 60)}`,

  execute: async (args, ctx) => {
    if (!ctx.podcastSegmentId) {
      return {
        summary:
          "write_segment_transcript was called outside a podcast segment run.",
        data: {
          ok: false,
          items: [
            {
              kind: "generic" as const,
              text: "This tool only works in podcast-segment-run mode. The current run isn't tied to a podcast segment.",
            },
          ],
        },
        sources: [],
      };
    }

    const wordCount = args.plainText.split(/\s+/).filter(Boolean).length;
    const durationSec =
      args.durationSec ?? Math.max(1, Math.round(wordCount / APPROX_WORDS_PER_SECOND));

    try {
      // Idempotent on runId — the @unique index on SegmentTranscript.runId
      // means a retry creates duplicate-key errors. Use upsert via composite
      // delete+create pattern to keep semantics simple.
      const existing = await prisma.segmentTranscript.findUnique({
        where: { runId: ctx.runId },
        select: { id: true },
      });
      if (existing) {
        await prisma.segmentTranscript.delete({ where: { id: existing.id } });
      }

      const transcript = await prisma.segmentTranscript.create({
        data: {
          runId: ctx.runId,
          segmentId: ctx.podcastSegmentId,
          userId: ctx.userId,
          title: args.title,
          plainText: args.plainText,
          ssml: args.ssml ?? null,
          citations: args.citations as object,
          durationSec,
          status: "READY",
        },
      });

      // Persist a thesis_complete-equivalent RunEvent so the runs feed shows
      // something happened during this run.
      try {
        await prisma.runEvent.create({
          data: {
            runId: ctx.runId,
            type: "transcript_complete",
            title: `Transcript ready: ${args.title}`,
            message: `${wordCount} words · ~${durationSec}s · ${args.citations.length} citations`,
            payload: {
              transcriptId: transcript.id,
              wordCount,
              durationSec,
              citationCount: args.citations.length,
            } as object,
          },
        });
      } catch (evtErr) {
        console.error(
          `[tool] write_segment_transcript run-event failed:`,
          evtErr instanceof Error ? evtErr.message : evtErr,
        );
      }

      // Return rich data so TranscriptCardRenderer can render the full
      // card + citation Sheet inline. Mirror of how record_thesis returns
      // its full thesis shape for the ThesisCardRenderer.
      return {
        summary: `Transcript saved: ${args.title} (${wordCount} words, ${args.citations.length} citations)`,
        data: {
          ok: true,
          transcriptId: transcript.id,
          title: args.title,
          plainText: args.plainText,
          wordCount,
          durationSec,
          citationCount: args.citations.length,
          citations: args.citations,
        },
        sources: args.citations.slice(0, 6).map((c) => ({
          provider: hostnameOf(c.url),
          title: c.claim,
          url: c.url,
          excerpt: c.quote,
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcript save failed";
      console.error(`[tool] write_segment_transcript FAILED:`, msg);
      return {
        summary: `Transcript save failed: ${msg}`,
        data: {
          ok: false,
          error: msg,
        },
        sources: [],
      };
    }
  },
});

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "source";
  }
}
