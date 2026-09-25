-- A refusal is never the end: an open refusal is carried to the next run and
-- shown on the Activity feed until the same tool lands on the same stock.
ALTER TABLE "GateRejection" ADD COLUMN "thesisId" TEXT;
ALTER TABLE "GateRejection" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "GateRejection" ADD COLUMN "resolvedBy" TEXT;
CREATE INDEX "GateRejection_analystId_resolvedAt_createdAt_idx" ON "GateRejection"("analystId", "resolvedAt", "createdAt" DESC);

-- Rows written before the ledger was read cannot say whether they were
-- answered (GD's 09-25 edit landed five seconds after its refusal, PLTR's
-- buy never did). They are closed as history so the first run after this
-- deploy is not told to redo three weeks of settled calls; new rows start open.
UPDATE "GateRejection" SET "resolvedAt" = "createdAt", "resolvedBy" = 'history:before-2026-09-25' WHERE "resolvedAt" IS NULL;
