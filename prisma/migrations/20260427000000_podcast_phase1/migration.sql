-- Phase 1 podcast PoC — additive schema for podcast feature.
--
-- Adds 4 new tables (Podcast, PodcastSegment, SegmentTranscript, Episode),
-- 2 enums (SegmentTranscriptStatus, EpisodeStatus), and 2 nullable FK
-- columns on existing tables (ResearchRun.podcastSegmentId,
-- Monitor.podcastSegmentId).
--
-- Non-destructive. Trading code is untouched. Existing rows get NULL for
-- the new FKs by default.
--
-- ROLLBACK: see prisma/migrations/_podcast_teardown.sql for the inverse
-- script. Safe to run as a single transaction.
--
-- See docs/PODCAST_PLAN.md and docs/PODCAST_FILES.md.

-- ─── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE "SegmentTranscriptStatus" AS ENUM (
  'DRAFT',
  'READY',
  'SYNTHESIZING',
  'AUDIO_READY',
  'FAILED'
);

CREATE TYPE "EpisodeStatus" AS ENUM (
  'DRAFT',
  'ASSEMBLING',
  'READY',
  'FAILED'
);

-- ─── Podcast ───────────────────────────────────────────────────────────────

CREATE TABLE "Podcast" (
  "id"             TEXT PRIMARY KEY,
  "userId"         TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "hostStyle"      TEXT,
  "voiceId"        TEXT,
  "coverArtUrl"    TEXT,
  "cadence"        TEXT,
  "enabled"        BOOLEAN NOT NULL DEFAULT TRUE,
  "builderPrompt"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

CREATE INDEX "Podcast_userId_idx" ON "Podcast" ("userId");

-- ─── PodcastSegment ────────────────────────────────────────────────────────

CREATE TABLE "PodcastSegment" (
  "id"            TEXT PRIMARY KEY,
  "podcastId"     TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "segmentPrompt" TEXT NOT NULL,
  "targetSeconds" INTEGER NOT NULL DEFAULT 300,
  "orderIndex"    INTEGER NOT NULL DEFAULT 0,
  "enabled"       BOOLEAN NOT NULL DEFAULT TRUE,
  "topics"        TEXT[] NOT NULL DEFAULT '{}',
  "sources"       TEXT[] NOT NULL DEFAULT '{}',
  "excludeTopics" TEXT[] NOT NULL DEFAULT '{}',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PodcastSegment_podcastId_fkey"
    FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE
);

CREATE INDEX "PodcastSegment_podcastId_idx" ON "PodcastSegment" ("podcastId");
CREATE INDEX "PodcastSegment_userId_idx"    ON "PodcastSegment" ("userId");

-- ─── SegmentTranscript ─────────────────────────────────────────────────────

CREATE TABLE "SegmentTranscript" (
  "id"            TEXT PRIMARY KEY,
  "runId"         TEXT NOT NULL UNIQUE,
  "segmentId"     TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "plainText"     TEXT NOT NULL,
  "ssml"          TEXT,
  "citations"     JSONB NOT NULL,
  "durationSec"   INTEGER,
  "audioUrl"      TEXT,
  "alignmentJson" JSONB,
  "status"        "SegmentTranscriptStatus" NOT NULL DEFAULT 'READY',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SegmentTranscript_segmentId_fkey"
    FOREIGN KEY ("segmentId") REFERENCES "PodcastSegment"("id") ON DELETE CASCADE
  -- ResearchRun FK added below after the new column lands on ResearchRun.
);

CREATE INDEX "SegmentTranscript_segmentId_idx" ON "SegmentTranscript" ("segmentId");
CREATE INDEX "SegmentTranscript_userId_idx"    ON "SegmentTranscript" ("userId");

-- ─── Episode ───────────────────────────────────────────────────────────────

CREATE TABLE "Episode" (
  "id"                TEXT PRIMARY KEY,
  "podcastId"         TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "description"       TEXT,
  "publishedAt"       TIMESTAMP(3),
  "transcriptIds"     TEXT[] NOT NULL DEFAULT '{}',
  "audioUrl"          TEXT,
  "durationSec"       INTEGER,
  "combinedAlignment" JSONB,
  "status"            "EpisodeStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Episode_podcastId_fkey"
    FOREIGN KEY ("podcastId") REFERENCES "Podcast"("id") ON DELETE CASCADE
);

CREATE INDEX "Episode_podcastId_idx" ON "Episode" ("podcastId");
CREATE INDEX "Episode_userId_idx"    ON "Episode" ("userId");

-- ─── Existing tables: add nullable podcastSegmentId FK ─────────────────────

ALTER TABLE "ResearchRun"
  ADD COLUMN "podcastSegmentId" TEXT,
  ADD CONSTRAINT "ResearchRun_podcastSegmentId_fkey"
    FOREIGN KEY ("podcastSegmentId") REFERENCES "PodcastSegment"("id") ON DELETE SET NULL;

CREATE INDEX "ResearchRun_podcastSegmentId_idx" ON "ResearchRun" ("podcastSegmentId");

ALTER TABLE "Monitor"
  ADD COLUMN "podcastSegmentId" TEXT,
  ADD CONSTRAINT "Monitor_podcastSegmentId_fkey"
    FOREIGN KEY ("podcastSegmentId") REFERENCES "PodcastSegment"("id") ON DELETE CASCADE;

CREATE INDEX "Monitor_podcastSegmentId_idx" ON "Monitor" ("podcastSegmentId");

-- ─── SegmentTranscript FK back to ResearchRun ──────────────────────────────
-- Done last so ResearchRun.podcastSegmentId column exists. The unique constraint
-- on SegmentTranscript.runId enforces 1:1 — each run has at most one transcript.

ALTER TABLE "SegmentTranscript"
  ADD CONSTRAINT "SegmentTranscript_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE;
