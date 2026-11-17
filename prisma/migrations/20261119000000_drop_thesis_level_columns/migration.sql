-- Second half of the two-PR column drop (docs/plans/PROD_DEPLOYMENT_PLAN.md).
-- Drops Thesis.entryPrice, Thesis.targetPrice and Thesis.stopLoss: a cache of
-- the plan levels, and a stock has triggers and nothing else (2026-11-16).
-- #998 removed every read and write of the three and their fields in
-- schema.prisma. Checked 2026-11-16 against production: all three columns
-- still exist, and no view, function, trigger, index, constraint or policy
-- depends on them. Position has its own stopLoss and targetPrice; they stay.
--
-- The values are kept first, in a table of their own (one row per Thesis, the
-- id and the three numbers), so a level can still be read back. Every public
-- table has deny-all RLS, so the backup does too.
CREATE TABLE IF NOT EXISTS "_thesis_levels_backup_20261119" AS
SELECT id, "entryPrice", "targetPrice", "stopLoss" FROM "Thesis";

ALTER TABLE "_thesis_levels_backup_20261119" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Thesis" DROP COLUMN IF EXISTS "entryPrice",
DROP COLUMN IF EXISTS "targetPrice",
DROP COLUMN IF EXISTS "stopLoss";
