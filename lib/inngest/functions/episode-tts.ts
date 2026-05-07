/**
 * episode-tts — Inngest function for ElevenLabs TTS generation.
 *
 * Triggered by `podcast/episode.tts.requested` (dispatched by
 * `triggerEpisodeAudio` server action after the user clicks "Generate audio").
 *
 * Steps:
 *   1. load-episode               — fetch Episode + ordered transcripts from DB
 *   2. generate-and-upload-audio  — TTS via ElevenLabs + write MP3 to Supabase
 *      Storage in a single step. Combined so the raw audio buffer never
 *      crosses an Inngest step boundary (it can exceed Inngest's 1MB step
 *      output cap, producing an "error validating generator opcode" failure).
 *   3. update-episode             — set audioUrl, durationSec, combinedAlignment, status=READY
 *
 * On failure: episode status is set to FAILED and the error is re-thrown so
 * Inngest records a failed run. Retries: 2 (set in the function config).
 *
 * Storage path: {userId}/episodes/{episodeId}.mp3
 * Bucket: podcast-audio  (must exist in Supabase Storage before deploy;
 * set to private — audioUrl is a signed URL valid for 7 days).
 *
 * Tagged PODCAST-NEW in docs/PODCAST_FILES.md (Session 2).
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { createServiceClient } from "@/lib/supabase/service";
import { generateEpisodeAudio } from "@/lib/podcast/elevenlabs";
import { resolveElevenLabsKey } from "@/lib/actions/api-keys.actions";

const BUCKET = "podcast-audio";
// Signed URL valid for 7 days (604800 seconds)
const SIGNED_URL_EXPIRY = 60 * 60 * 24 * 7;

export const episodeTts = inngest.createFunction(
  {
    id: "episode-tts",
    name: "Episode TTS — ElevenLabs Audio Generation",
    retries: 2,
  },
  { event: "podcast/episode.tts.requested" },
  async ({ event, step }) => {
    const { episodeId, userId, voiceId } = event.data as {
      episodeId: string;
      userId: string;
      podcastId: string;
      voiceId: string;
    };

    try {
      // ── Step 1: Load episode + transcripts ──────────────────────────────

      const { fullText, transcriptCount } = await step.run(
        "load-episode",
        async () => {
          const episode = await prisma.episode.findFirst({
            where: { id: episodeId, userId },
          });
          if (!episode) throw new Error(`Episode ${episodeId} not found`);
          if (episode.status !== "ASSEMBLING") {
            throw new Error(
              `Episode ${episodeId} is not in ASSEMBLING state (got ${episode.status})`,
            );
          }

          const ids = episode.transcriptIds;
          if (ids.length === 0) throw new Error("Episode has no transcripts");

          const rows = await prisma.segmentTranscript.findMany({
            where: { id: { in: ids }, userId },
            select: { id: true, plainText: true },
          });
          const byId = new Map(rows.map((r) => [r.id, r.plainText]));
          const fullText = ids
            .map((id) => byId.get(id) ?? "")
            .join("\n\n")
            .trim();

          if (!fullText) {
            throw new Error("Concatenated transcript text is empty");
          }

          return { fullText, transcriptCount: ids.length };
        },
      );

      // ── Step 2: Generate audio + upload (combined) ──────────────────────
      //
      // Combined into ONE step so the raw audio buffer never crosses an
      // Inngest step boundary. ElevenLabs MP3 + alignment for a multi-
      // thousand-char episode runs ~600KB-1MB+ as base64; Inngest's per-
      // step output cap is 1MB on cloud, and exceeding it produces an
      // "error validating generator opcode" failure that retries until
      // the run dies. By uploading to Supabase Storage inside the same
      // step, only the signed URL + alignment metadata leave the step.

      const { audioUrl, combinedAlignment, durationSec } = await step.run(
        "generate-and-upload-audio",
        async () => {
          const apiKey = await resolveElevenLabsKey();
          if (!apiKey) {
            throw new Error(
              "ELEVENLABS_API_KEY is not set in the environment.",
            );
          }

          const result = await generateEpisodeAudio(fullText, voiceId, apiKey);

          const supabase = createServiceClient();
          const path = `${userId}/episodes/${episodeId}.mp3`;

          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, result.audioBuffer, {
              contentType: "audio/mpeg",
              upsert: true,
            });
          if (uploadError) {
            throw new Error(`Storage upload failed: ${uploadError.message}`);
          }

          const { data: signedData, error: signError } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, SIGNED_URL_EXPIRY);
          if (signError || !signedData?.signedUrl) {
            throw new Error(
              `Failed to create signed URL: ${signError?.message ?? "unknown"}`,
            );
          }

          return {
            audioUrl: signedData.signedUrl,
            combinedAlignment: result.combinedAlignment,
            durationSec: result.durationSec,
          };
        },
      );

      // ── Step 4: Update episode row ──────────────────────────────────────

      await step.run("update-episode", async () => {
        await prisma.episode.update({
          where: { id: episodeId },
          data: {
            audioUrl,
            durationSec,
            combinedAlignment: combinedAlignment as object,
            status: "READY",
          },
        });
      });

      return { episodeId, transcriptCount, durationSec, audioUrl };
    } catch (err) {
      // Mark episode FAILED on any unhandled error, then re-throw so Inngest
      // records a failed run and can retry (up to retries: 2).
      await prisma.episode
        .update({
          where: { id: episodeId },
          data: { status: "FAILED" },
        })
        .catch(() => {/* best-effort — don't mask the original error */});
      throw err;
    }
  },
);
