-- ════════════════════════════════════════════════════════════════════════════
-- PODCAST FEATURE TEARDOWN — manual rollback script.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run this script to fully drop the podcast feature from the database.
-- Safe to run; non-destructive to trading data. Trading tables, columns,
-- and rows are untouched.
--
-- This file is NOT a Prisma migration (filename starts with `_`, so the
-- migrate runner skips it). To roll back the podcast feature:
--
--   1. Apply this script to the database (psql / Supabase SQL editor).
--   2. Remove the podcast models + FK additions from prisma/schema.prisma.
--   3. Run `prisma migrate resolve --rolled-back 20260427000000_podcast_phase1`
--      so Prisma's _prisma_migrations table reflects the rollback.
--   4. Run `prisma generate` so the client types stop referencing podcast tables.
--   5. Delete the podcast files listed in docs/PODCAST_FILES.md PODCAST-NEW.
--
-- See docs/PODCAST_FILES.md "Schema teardown" section for the full audit.
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Drop FK constraints first (the columns themselves get dropped below) ──
ALTER TABLE "ResearchRun" DROP CONSTRAINT IF EXISTS "ResearchRun_podcastSegmentId_fkey";
ALTER TABLE "Monitor"     DROP CONSTRAINT IF EXISTS "Monitor_podcastSegmentId_fkey";

-- ─── Drop new tables (CASCADE drops the FKs they participate in + their indexes)
-- Order matters: child tables first.
DROP TABLE IF EXISTS "SegmentTranscript" CASCADE;
DROP TABLE IF EXISTS "Episode"           CASCADE;
DROP TABLE IF EXISTS "PodcastSegment"    CASCADE;
DROP TABLE IF EXISTS "Podcast"           CASCADE;

-- ─── Drop the new columns on existing tables ──────────────────────────────
DROP INDEX IF EXISTS "ResearchRun_podcastSegmentId_idx";
ALTER TABLE "ResearchRun" DROP COLUMN IF EXISTS "podcastSegmentId";

DROP INDEX IF EXISTS "Monitor_podcastSegmentId_idx";
ALTER TABLE "Monitor"     DROP COLUMN IF EXISTS "podcastSegmentId";

-- ─── Drop enums ────────────────────────────────────────────────────────────
DROP TYPE IF EXISTS "SegmentTranscriptStatus";
DROP TYPE IF EXISTS "EpisodeStatus";

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- Sanity check after running:
--
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('Podcast', 'PodcastSegment', 'SegmentTranscript', 'Episode');
--   -- expect: 0 rows
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name IN ('ResearchRun', 'Monitor')
--      AND column_name = 'podcastSegmentId';
--   -- expect: 0 rows
--
--   SELECT typname FROM pg_type
--    WHERE typname IN ('SegmentTranscriptStatus', 'EpisodeStatus');
--   -- expect: 0 rows
-- ════════════════════════════════════════════════════════════════════════════
