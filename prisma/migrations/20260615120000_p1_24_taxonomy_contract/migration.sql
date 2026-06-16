-- P1-24 status taxonomy — CONTRACT (destructive enum shrink).
-- See docs/plans/STATUS_TAXONOMY.md.
--
-- Removes the legacy ThesisStatus values {ACTIVE, INVALIDATED, CLOSED,
-- ARCHIVED, SUPERSEDED}. The DB is already fully migrated to the clean model
-- (WATCHING / HOLDING / PASSED / RETIRED / PROMOTED) and direction is
-- LONG | SHORT | null. This migration must run ONLY AFTER the paired contract
-- *code* PR has deployed green in prod — once nothing reads or writes the
-- legacy values.
--
-- Postgres cannot DROP a value from an enum in place, so this does the
-- create-new-type / swap-column / drop-old-type dance.
--
-- ⚠️ DO NOT auto-apply. The principal applies this manually (Supabase project
-- zomxxtqiszpkqrjrqqat) with explicit approval, after counting/verifying that
-- zero Thesis rows still hold a legacy status (step 0 enforces this anyway).

-- 0. Safety guard — refuse the swap if any Thesis row still holds a legacy
--    status value. Belt-and-suspenders: the backfill should already be done.
DO $$
DECLARE
  legacy_count integer;
BEGIN
  SELECT count(*) INTO legacy_count
  FROM "Thesis"
  WHERE "status"::text IN ('ACTIVE', 'INVALIDATED', 'CLOSED', 'ARCHIVED', 'SUPERSEDED');
  IF legacy_count > 0 THEN
    RAISE EXCEPTION
      'Aborting ThesisStatus contraction: % Thesis row(s) still hold a legacy status. Backfill to the clean model before contracting the enum.',
      legacy_count;
  END IF;
END $$;

-- 1. New enum with only the final five values.
CREATE TYPE "ThesisStatus_new" AS ENUM ('WATCHING', 'HOLDING', 'PASSED', 'RETIRED', 'PROMOTED');

-- 2. Drop the column default (it references the old type) before the swap.
ALTER TABLE "Thesis" ALTER COLUMN "status" DROP DEFAULT;

-- 3. Swap the column to the new type. The text round-trip is safe because the
--    guard above proved every live value exists in the new enum.
ALTER TABLE "Thesis"
  ALTER COLUMN "status" TYPE "ThesisStatus_new"
  USING ("status"::text::"ThesisStatus_new");

-- 4. Drop the old type and rename the new one into its place.
DROP TYPE "ThesisStatus";
ALTER TYPE "ThesisStatus_new" RENAME TO "ThesisStatus";

-- 5. Re-establish the default on the contracted type (was ACTIVE; now WATCHING).
ALTER TABLE "Thesis" ALTER COLUMN "status" SET DEFAULT 'WATCHING';
