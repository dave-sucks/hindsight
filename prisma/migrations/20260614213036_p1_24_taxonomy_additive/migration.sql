-- P1-24 status taxonomy — PR A (additive, non-destructive).
-- See docs/plans/STATUS_TAXONOMY.md. Nothing reads or writes the new values
-- yet; PR B backfills existing rows + flips the writers.
--
-- NOTE: if `prisma migrate deploy` rejects the ALTER TYPE ... ADD VALUE lines
-- with "cannot run inside a transaction block", run those three lines once by
-- hand first (Supabase/PG15 allows them; they are idempotent), then re-run
-- deploy for the rest.

-- 1. New ThesisStatus values — the clean 4-state model.
--    HOLDING (= old ACTIVE), PASSED (= direction=PASS + ARCHIVED-at-write),
--    RETIRED (= CLOSED/INVALIDATED/ARCHIVED/SUPERSEDED). Old values stay until PR E.
ALTER TYPE "ThesisStatus" ADD VALUE IF NOT EXISTS 'HOLDING';
ALTER TYPE "ThesisStatus" ADD VALUE IF NOT EXISTS 'PASSED';
ALTER TYPE "ThesisStatus" ADD VALUE IF NOT EXISTS 'RETIRED';

-- 2. retiredReason — "DROPPED" | "SOLD" | "INVALIDATED" | "REPLACED"; null otherwise.
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "retiredReason" TEXT;

-- 3. direction becomes nullable (null = unresearched watchlist add).
ALTER TABLE "Thesis" ALTER COLUMN "direction" DROP NOT NULL;
