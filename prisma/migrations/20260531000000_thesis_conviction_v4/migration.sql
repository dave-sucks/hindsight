-- Conviction Expression v4 — writer-side fields
-- See docs/plans/CONVICTION_EXPRESSION.md §3, §9
--
-- Three nullable columns. PASS theses, PENDING seeds, and pre-v4 legacy
-- rows leave them null. Layer-1 gates in record_thesis/update_thesis
-- enforce required-when-directional after this ships.
--
-- Backfill for ~50 existing rows is shipped as a separate one-shot script
-- (NOT part of this migration) so the Prisma migration history stays clean.

ALTER TABLE "Thesis" ADD COLUMN "conviction" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "convictionRationale" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "variantView" TEXT;
