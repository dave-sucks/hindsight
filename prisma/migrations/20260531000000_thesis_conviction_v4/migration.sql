-- Conviction Expression v4 — writer-side fields
-- See docs/plans/CONVICTION_EXPRESSION.md §3, §9
--
-- Three nullable columns. PASS theses, PENDING seeds, and pre-v4 legacy
-- rows leave them null. Layer-1 gates in record_thesis/update_thesis
-- enforce required-when-directional after this ships.
--
-- Backfill for ~50 existing rows is shipped as a separate one-shot script
-- (NOT part of this migration) so the Prisma migration history stays clean.

-- IF NOT EXISTS makes this migration safe to re-apply. The columns were
-- added manually to production on 2026-05-31 during a UI preview pass
-- (before the Prisma migration had been deployed). When `prisma migrate
-- deploy` runs post-merge, this is a no-op on prod and a clean add
-- elsewhere.
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "conviction" TEXT;
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "convictionRationale" TEXT;
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "variantView" TEXT;
