-- Watchlist collapse — one-shot migration.
--
-- See docs/WATCHLIST_COLLAPSE_PLAN.md for the full lifecycle spec.
--
-- This migration:
--   1. Adds ARCHIVED to the ThesisStatus enum (PASS theses + manual removals
--      land here; never appears on the watchlist).
--   2. Backfills existing PASS WATCHING rows to PASS ARCHIVED (the old
--      "institutional memory" pattern is replaced by the new lifecycle).
--   3. Backfills orphan AnalystWatchlistItem(status='ACTIVE') rows that
--      have no matching Thesis(WATCHING/ACTIVE) as PENDING WATCHING
--      theses, anchored to a synthetic per-analyst MANUAL ResearchRun.
--   4. Verifies zero drift.
--   5. Drops the AnalystWatchlistItem table entirely.
--   6. Drops the AgentConfig.watchlist String[] legacy mirror column.
--
-- After this migration, Thesis is the single store. There is no second
-- table to drift against.
--
-- New (direction, status) values used here:
--   direction='PENDING' — user/builder/editor seed, awaiting first research.
--                          Stored as a String, no enum migration required.
--   status='ARCHIVED'   — terminal-without-trade (PASS at write, manual
--                          remove). New enum value below.
--
-- New source_kind values (String column, no migration required):
--   USER_ADDED, BUILDER_SEED, EDITOR_SEED.

-- ─── 1. ARCHIVED status enum addition ───────────────────────────────────────
ALTER TYPE "ThesisStatus" ADD VALUE 'ARCHIVED';

-- Postgres requires enum values to be committed before they can be used in
-- the same transaction. Split into a separate step that Prisma will run
-- after the schema migration commits.
COMMIT;
BEGIN;

-- ─── 2. Backfill PASS WATCHING → PASS ARCHIVED ──────────────────────────────
-- Existing rows in production (FIVN, MSFT, plus any others) carried the
-- "PASS WATCHING for institutional memory" pattern. Under the new lifecycle
-- model PASS is always terminal. Transition them to ARCHIVED in place.
WITH archived_theses AS (
  UPDATE "Thesis"
  SET    "status" = 'ARCHIVED'
  WHERE  "direction" = 'PASS' AND "status" = 'WATCHING'
  RETURNING "id"
)
INSERT INTO "ThesisUpdate" (
  "id", "thesisId", "type", "summary", "rationale",
  "fieldChanges", "timestamp"
)
SELECT
  gen_random_uuid()::text,
  at."id",
  'STATUS_CHANGED',
  'Backfill: PASS WATCHING → PASS ARCHIVED under new lifecycle model',
  'Migration 20260513_watchlist_collapse — PASS theses are now terminal at write. ' ||
    'Institutional-memory value is preserved on the stock detail page and via ' ||
    'get_theses(include_history). See docs/WATCHLIST_COLLAPSE_PLAN.md.',
  '{"status": {"from": "WATCHING", "to": "ARCHIVED"}}'::jsonb,
  NOW()
FROM archived_theses at;

-- ─── 3. Backfill orphan AnalystWatchlistItem → PENDING WATCHING theses ──────
-- Every AnalystWatchlistItem with status='ACTIVE' that lacks a matching
-- ACTIVE/WATCHING Thesis on (analystId, ticker) gets a freshly-minted
-- PENDING WATCHING thesis anchored to a synthetic MANUAL ResearchRun.

-- 3a. Ensure a MANUAL ResearchRun exists for every analyst with orphans.
WITH analysts_with_orphans AS (
  SELECT DISTINCT awi."analystId", awi."userId", awi."accountId"
  FROM   "AnalystWatchlistItem" awi
  WHERE  awi."status" = 'ACTIVE'
    AND  NOT EXISTS (
      SELECT 1
      FROM   "Thesis" t
      JOIN   "ResearchRun" rr ON rr."id" = t."researchRunId"
      WHERE  rr."agentConfigId" = awi."analystId"
        AND  t."ticker" = awi."symbol"
        AND  t."status" IN ('ACTIVE', 'WATCHING')
    )
)
INSERT INTO "ResearchRun" (
  "id", "userId", "accountId", "agentConfigId",
  "source", "status", "mode", "environment", "parameters",
  "startedAt", "completedAt", "createdAt", "updatedAt"
)
SELECT
  'manual-' || awo."analystId",
  awo."userId",
  awo."accountId",
  awo."analystId",
  'MANUAL',
  'COMPLETE',
  'MANUAL',
  'PAPER',
  '{"note": "Synthetic anchor for manual watchlist adds; see lib/agent/manual-run-anchor.ts"}'::jsonb,
  NOW(),
  NOW(),
  NOW(),
  NOW()
FROM analysts_with_orphans awo
ON CONFLICT ("id") DO NOTHING;

-- 3b. Mint PENDING WATCHING theses for orphan items.
WITH orphan_items AS (
  SELECT awi."id"            AS awi_id,
         awi."analystId",
         awi."userId",
         awi."accountId",
         awi."symbol",
         awi."reason",
         awi."addedBy",
         awi."createdAt"
  FROM   "AnalystWatchlistItem" awi
  WHERE  awi."status" = 'ACTIVE'
    AND  NOT EXISTS (
      SELECT 1
      FROM   "Thesis" t
      JOIN   "ResearchRun" rr ON rr."id" = t."researchRunId"
      WHERE  rr."agentConfigId" = awi."analystId"
        AND  t."ticker" = awi."symbol"
        AND  t."status" IN ('ACTIVE', 'WATCHING')
    )
),
inserted_theses AS (
  INSERT INTO "Thesis" (
    "id", "researchRunId", "userId", "accountId", "ticker",
    "source", "direction", "status",
    "holdDuration", "confidenceScore", "reasoningSummary",
    "thesisBullets", "riskFlags", "signalTypes",
    "sourcesUsed", "modelUsed",
    "sourceKind", "sourceRationale", "sourceSignalIds",
    "nextReviewAt", "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::text,
    'manual-' || oi."analystId",
    oi."userId",
    oi."accountId",
    oi."symbol",
    'MANUAL',
    'PENDING',
    'WATCHING',
    'SWING',
    50,
    COALESCE(NULLIF(oi."reason", ''), 'Backfilled from watchlist'),
    ARRAY[]::text[],
    ARRAY[]::text[],
    ARRAY[]::text[],
    '[]'::jsonb,
    'backfill',
    CASE oi."addedBy"
      WHEN 'USER'    THEN 'USER_ADDED'
      WHEN 'BUILDER' THEN 'BUILDER_SEED'
      WHEN 'AGENT'   THEN 'WATCHLIST_REVIEW'
      ELSE 'USER_ADDED'
    END,
    'Backfilled from AnalystWatchlistItem during watchlist-collapse migration.',
    ARRAY[]::text[],
    NOW(),
    oi."createdAt",
    NOW()
  FROM orphan_items oi
  RETURNING "id", "ticker", "researchRunId"
)
INSERT INTO "ThesisUpdate" (
  "id", "thesisId", "type", "summary", "rationale",
  "fieldChanges", "timestamp", "runId"
)
SELECT
  gen_random_uuid()::text,
  it."id",
  'CREATED',
  'Backfilled from watchlist — awaiting first research',
  'Migration 20260513_watchlist_collapse — orphan AnalystWatchlistItem ' ||
    'with no matching Thesis was minted as PENDING WATCHING. The next daily ' ||
    'run will research it (nextReviewAt = now). See docs/WATCHLIST_COLLAPSE_PLAN.md.',
  '{}'::jsonb,
  NOW(),
  it."researchRunId"
FROM inserted_theses it;

-- ─── 4. Verify zero drift before destructive step ───────────────────────────
DO $$
DECLARE
  drift_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO   drift_count
  FROM   "AnalystWatchlistItem" awi
  WHERE  awi."status" = 'ACTIVE'
    AND  NOT EXISTS (
      SELECT 1
      FROM   "Thesis" t
      JOIN   "ResearchRun" rr ON rr."id" = t."researchRunId"
      WHERE  rr."agentConfigId" = awi."analystId"
        AND  t."ticker" = awi."symbol"
        AND  t."status" IN ('ACTIVE', 'WATCHING')
    );

  IF drift_count > 0 THEN
    RAISE EXCEPTION 'Watchlist-collapse backfill failed: % orphan AnalystWatchlistItem rows remain', drift_count;
  END IF;

  RAISE NOTICE 'Watchlist-collapse backfill verified: zero drift. Dropping legacy table.';
END $$;

-- ─── 5. Drop the AnalystWatchlistItem table ─────────────────────────────────
-- No more dual-store. Thesis is the single source of truth for the watchlist.
DROP TABLE "AnalystWatchlistItem";

-- ─── 6. Drop the AgentConfig.watchlist String[] legacy mirror ───────────────
-- Synced today via syncLegacyWatchlist; replaced by Thesis(WATCHING) queries.
ALTER TABLE "AgentConfig" DROP COLUMN "watchlist";
