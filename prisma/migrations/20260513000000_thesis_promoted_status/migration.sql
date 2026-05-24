-- PROMOTED thesis status — the dedicated state for theses whose paper
-- positions were force-closed during PAPER→LIVE analyst promotion.
-- Sits between ACTIVE-with-position and WATCHING semantically:
-- the conviction is intact, the position is gone, the next live run
-- is expected to decide place_trade or downgrade to WATCHING.
-- update_thesis / record_thesis reject PROMOTED as input.
-- See docs/PROD_DEPLOYMENT_PLAN.md.

-- Add PROMOTED to the ThesisStatus enum. Safe additive enum change.
ALTER TYPE "ThesisStatus" ADD VALUE IF NOT EXISTS 'PROMOTED';

-- Conviction context frozen at promotion time. Null until the thesis
-- has been through a PAPER→LIVE event. Drives first-live-run review UI
-- and the agent's Stage 2 prompt framing for PROMOTED theses.
ALTER TABLE "Thesis" ADD COLUMN "promotedAt"        TIMESTAMP(3);
ALTER TABLE "Thesis" ADD COLUMN "paperTenureDays"   INTEGER;
ALTER TABLE "Thesis" ADD COLUMN "paperRealizedPnl"  DOUBLE PRECISION;
ALTER TABLE "Thesis" ADD COLUMN "paperReviewCount"  INTEGER;
