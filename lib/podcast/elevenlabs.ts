/**
 * ElevenLabs TTS client for podcast audio generation.
 *
 * Uses the ElevenLabs REST API directly (no SDK) — fetch is sufficient.
 * Two concerns:
 *   1. Voice library fetching (cached per component render)
 *   2. Text-to-speech (with alignment marks for Session 4 karaoke)
 *
 * Chunking: ElevenLabs accepts ~10 000 chars per request but we cap at
 * CHUNK_SIZE for headroom. Chunks are split at sentence boundaries.
 * Returned audio buffers are concatenated as raw MP3 bytes — valid for
 * same-encoding MP3 streams at equal bitrate (which ElevenLabs guarantees
 * for a single voice/model combo).
 *
 * Tagged PODCAST-NEW in docs/PODCAST_FILES.md.
 */

const BASE = "https://api.elevenlabs.io/v1";
const CHUNK_SIZE = 5_000; // chars per TTS request
const MODEL_ID = "eleven_monolingual_v1";

// ── Cost estimate ─────────────────────────────────────────────────────────────
// Starter plan ~$0.30 / 1 000 characters. Surface to user before generation.
export const ELEVENLABS_COST_PER_CHAR = 0.0003;

export function estimateCost(charCount: number): number {
  return Math.round(charCount * ELEVENLABS_COST_PER_CHAR * 100) / 100;
}

// ── Voice types ───────────────────────────────────────────────────────────────

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  preview_url: string | null;
  labels: Record<string, string>;
}

// ── Alignment types (Session 4 karaoke) ──────────────────────────────────────

export interface ChunkAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
  /** Offset applied to raw ElevenLabs times so chunk aligns within episode. */
  offsetSeconds: number;
}

export interface CombinedAlignment {
  chunks: ChunkAlignment[];
  totalDurationSec: number;
}

// ── Auth header helper ────────────────────────────────────────────────────────
// All ElevenLabs keys — including scoped sk_* keys — authenticate via xi-api-key.

function elevenLabsHeaders(apiKey: string): Record<string, string> {
  return { "xi-api-key": apiKey };
}

// ── Voice library ─────────────────────────────────────────────────────────────

export async function listVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const res = await fetch(`${BASE}/voices`, { headers: elevenLabsHeaders(apiKey) });
  if (!res.ok) {
    throw new Error(`ElevenLabs /voices failed: ${res.status}`);
  }
  const data = (await res.json()) as { voices: ElevenLabsVoice[] };
  return data.voices;
}

// ── Key verification ──────────────────────────────────────────────────────────

export async function verifyElevenLabsKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/user`, {
      headers: elevenLabsHeaders(apiKey),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Text chunking ─────────────────────────────────────────────────────────────

export function chunkText(text: string, maxChars = CHUNK_SIZE): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    // Find last sentence boundary before the limit
    const slice = remaining.slice(0, maxChars);
    const lastPeriod = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf(".\n"),
    );
    const cutAt = lastPeriod > maxChars * 0.5 ? lastPeriod + 2 : maxChars;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// ── Single-chunk TTS ──────────────────────────────────────────────────────────

interface ChunkResult {
  audioBuffer: Buffer;
  alignment: ChunkAlignment;
}

async function ttsChunk(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<ChunkResult> {
  const res = await fetch(
    `${BASE}/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: {
        ...elevenLabsHeaders(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    audio_base64: string;
    alignment: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  };

  return {
    audioBuffer: Buffer.from(data.audio_base64, "base64"),
    alignment: {
      characters: data.alignment.characters,
      character_start_times_seconds:
        data.alignment.character_start_times_seconds,
      character_end_times_seconds: data.alignment.character_end_times_seconds,
      offsetSeconds: 0, // filled in by caller
    },
  };
}

// ── Full episode TTS ──────────────────────────────────────────────────────────

export interface EpisodeAudioResult {
  audioBuffer: Buffer;
  combinedAlignment: CombinedAlignment;
  durationSec: number;
}

export async function generateEpisodeAudio(
  fullText: string,
  voiceId: string,
  apiKey: string,
): Promise<EpisodeAudioResult> {
  const chunks = chunkText(fullText);
  const audioBuffers: Buffer[] = [];
  const alignmentChunks: ChunkAlignment[] = [];
  let offsetSeconds = 0;

  for (const chunk of chunks) {
    const result = await ttsChunk(chunk, voiceId, apiKey);
    audioBuffers.push(result.audioBuffer);

    const chunkDuration =
      result.alignment.character_end_times_seconds.at(-1) ?? 0;

    alignmentChunks.push({
      ...result.alignment,
      offsetSeconds,
    });

    offsetSeconds += chunkDuration;
  }

  const audioBuffer = Buffer.concat(audioBuffers);
  const combinedAlignment: CombinedAlignment = {
    chunks: alignmentChunks,
    totalDurationSec: offsetSeconds,
  };

  return {
    audioBuffer,
    combinedAlignment,
    durationSec: Math.round(offsetSeconds),
  };
}
