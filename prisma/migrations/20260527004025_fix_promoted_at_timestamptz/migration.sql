-- GAPS P1-4 — Thesis.promotedAt was created in 20260513000000_thesis_promoted_status
-- as bare `TIMESTAMP(3)` (timestamp without time zone). The Prisma
-- `@prisma/adapter-pg` write path AM/PM-flips JS `Date` writes into bare
-- timestamp columns, so the 3 PROMOTED rows in production (AVGO, TSM, MRVL,
-- all promoted 2026-05-26 04:42 UTC) stored as 2026-05-26 16:42 — exactly
-- 12 hours late. The audit-row peer `ThesisUpdate.timestamp` is written via
-- Postgres `now()` (column default) so it isn't affected by the adapter bug
-- and is the source of truth at 04:42:31 UTC.
--
-- Fix order matters:
--   1. Backfill the existing rows BEFORE the type change. They're still bare
--      `timestamp` here, so subtracting INTERVAL '12 hours' just shifts the
--      naive value into agreement with the audit row.
--   2. Convert column type to `timestamptz(6)`. The `USING ... AT TIME ZONE 'UTC'`
--      clause tells Postgres to interpret the (now-correct) bare values as UTC
--      so the stored instant doesn't change again.
--
-- After this migration every PROMOTED thesis's `Thesis.promotedAt` equals its
-- `STATUS_CHANGED → PROMOTED` audit row's `timestamp` to the second, and every
-- future write from `transitionThesisToPromoted` lands as the correct UTC
-- instant because adapter-pg serializes `Date → timestamptz` correctly.

-- Step 1 — backfill: shift the 3 (or however many) broken rows back 12 hours.
UPDATE "Thesis"
   SET "promotedAt" = "promotedAt" - INTERVAL '12 hours'
 WHERE "promotedAt" IS NOT NULL;

-- Step 2 — convert column type, treating the now-correct bare values as UTC.
ALTER TABLE "Thesis"
  ALTER COLUMN "promotedAt" TYPE TIMESTAMPTZ(6)
  USING "promotedAt" AT TIME ZONE 'UTC';
