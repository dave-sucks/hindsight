-- Phase 3 — soft-delete tombstone for Signal.
--
-- Signals age out of active queries via tradingDay (Phase 2). After 30 days
-- the pipeline-cleanup cron flips deletedAt non-null so the row stops
-- appearing in any read path. Theses retain sourceSignalIds and can still
-- resolve them against soft-deleted rows for historical attribution.

ALTER TABLE "Signal"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Signal_deletedAt_idx" ON "Signal" ("deletedAt");
