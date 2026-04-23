-- V3 Session 3 — Signal→Thesis→Monitor traceability.
--
-- Additive only. No backfill. Historical Thesis rows keep empty
-- `sourceSignalIds`; historical Monitor rows keep zero counters and NULL
-- successScore until a future position close walks the chain.
-- Zero-downtime: every added column has a default or is nullable.

ALTER TABLE "Thesis"
  ADD COLUMN "sourceSignalIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Monitor"
  ADD COLUMN "successScore"  DOUBLE PRECISION,
  ADD COLUMN "tradesSourced" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "winsSourced"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lossesSourced" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastOutcomeAt" TIMESTAMP(3);
