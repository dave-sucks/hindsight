-- ════════════════════════════════════════════════════════════════════════════
-- PODCAST FEATURE TEARDOWN — manual rollback script.
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run this script to fully drop the podcast feature from the database.
-- Trading tables, columns, and rows are untouched.
--
-- IMPORTANT — read before running:
--
-- The podcast feature DOES NOT live in 4 isolated tables. It writes rows
-- into 6 existing shared tables alongside trading data:
--
--   • ResearchRun  — each segment run is a real ResearchRun row
--                    (podcastSegmentId IS NOT NULL, agentConfigId IS NULL)
--   • RunEvent     — events for those runs (transcript_complete, etc.)
--   • RunMessage   — chat thread persistence for those runs
--   • Monitor      — segment search monitors
--                    (podcastSegmentId IS NOT NULL, analystId IS NULL)
--   • Signal       — stories surfaced by those segment monitors
--   • Artifact     — articles extracted by those signals
--
-- Section A drops the 4 podcast-specific tables + 2 FK columns + 2 enums.
-- After Section A, the schema is back to the trading-only shape, BUT the
-- shared tables still contain podcast-origin rows that are now orphaned
-- (their discriminator columns are gone).
--
-- Section B (commented out by default) PURGES those orphaned rows. Enable
-- it if you want a fully clean teardown. Skip it if you want to keep the
-- podcast run history for archival.
--
-- This file is NOT a Prisma migration (filename starts with `_`, so the
-- migrate runner skips it). Procedure:
--
--   1. (Optional, recommended) Enable Section B by uncommenting it.
--   2. Apply this script to the database (psql / Supabase SQL editor).
--   3. Remove the podcast models + FK additions from prisma/schema.prisma.
--   4. Run `prisma migrate resolve --rolled-back 20260427000000_podcast_phase1`
--      so Prisma's _prisma_migrations table reflects the rollback.
--   5. Run `prisma generate` so the client types stop referencing podcast tables.
--   6. Delete the podcast files listed in docs/PODCAST_FILES.md PODCAST-NEW.
--
-- See docs/PODCAST_FILES.md "Schema teardown" section for the full audit.
--
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION A — Drop podcast-specific schema objects.
-- Always run this part. Non-destructive to trading data.
-- ════════════════════════════════════════════════════════════════════════════

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
-- SECTION B — Purge orphaned podcast-origin rows from shared tables.
-- ════════════════════════════════════════════════════════════════════════════
--
-- After Section A, the shared tables (ResearchRun, RunEvent, RunMessage,
-- Monitor, Signal, Artifact) still contain rows that were created by the
-- podcast feature. They have no podcastSegmentId column anymore — that
-- discriminator is gone — so they're orphaned but harmless. Use this
-- section to physically remove them.
--
-- IMPORTANT: this section can ONLY work BEFORE you drop the
-- podcastSegmentId columns. So if you want to purge, run sections in
-- this order instead:
--
--   1. Run Section B FIRST (the queries below).
--   2. Then run Section A above.
--
-- That's why this section is commented out by default — the default flow
-- (run as-is, top-to-bottom) is for "drop schema but leave history alone."
-- If you want a full purge, copy the queries below into a separate
-- transaction and run them BEFORE Section A.
--
-- ── Queries to run BEFORE Section A for a full purge ──────────────────────
--
-- BEGIN;
--
-- -- Identify podcast-origin Monitor ids (segment monitors).
-- -- Signals point at these via monitorId; we need to null those out
-- -- before dropping the monitors so we don't break the FK.
-- -- (Signal.monitorId is ON DELETE SET NULL already, so dropping the
-- --  Monitor rows naturally clears the link — but we still want to
-- --  delete the Signals that were ONLY routed for podcast use, which
-- --  in Phase 1 is "all signals from podcast monitors" since segments
-- --  don't share signals with analysts.)
--
-- DELETE FROM "Signal"
--  WHERE "monitorId" IN (
--    SELECT "id" FROM "Monitor"
--     WHERE "podcastSegmentId" IS NOT NULL
--  );
--
-- -- Artifacts may be shared between trading and podcast runs (same URL),
-- -- so we don't blanket-delete. Only delete artifacts no Signal points
-- -- at anymore (orphans).
-- DELETE FROM "Artifact"
--  WHERE "id" NOT IN (
--    SELECT DISTINCT "artifactId" FROM "Signal" WHERE "artifactId" IS NOT NULL
--  );
--
-- -- Drop podcast Monitor rows (cascades clean up nothing else).
-- DELETE FROM "Monitor"
--  WHERE "podcastSegmentId" IS NOT NULL;
--
-- -- Drop podcast ResearchRun rows. Cascades to RunEvent, RunMessage,
-- -- and SegmentTranscript via their ON DELETE CASCADE constraints.
-- DELETE FROM "ResearchRun"
--  WHERE "podcastSegmentId" IS NOT NULL;
--
-- COMMIT;
--
-- ── Then run Section A above for the full schema teardown. ─────────────────

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

