-- Portfolio Digest — make it environment-aware (PAPER vs LIVE).
-- PAPER and LIVE share one accountId; environment is the discriminator
-- everywhere else (Position.environment, ResearchRun.environment). Without it,
-- a PAPER digest renders under the LIVE book. See docs/plans/PORTFOLIO_DIGEST.md.
--
-- Additive + safe:
--   * the new column lands NOT NULL via DEFAULT 'PAPER', which backfills the one
--     existing row to PAPER (correct — the cron only ever wrote the PAPER book).
--   * the old (accountId, date) unique index is replaced by the composite
--     (accountId, environment, date) so PAPER and LIVE can each keep a row per day.
--
-- DO NOT applied by this PR — the principal applies via Supabase MCP.

-- AlterTable: add environment, backfilling the existing row to PAPER via DEFAULT.
ALTER TABLE "PortfolioDigest" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'PAPER';

-- Future writes must set environment explicitly (the cron always does). Drop the
-- DEFAULT now that the backfill is done.
ALTER TABLE "PortfolioDigest" ALTER COLUMN "environment" DROP DEFAULT;

-- Swap the unique index: (accountId, date) → (accountId, environment, date).
DROP INDEX "PortfolioDigest_accountId_date_key";
CREATE UNIQUE INDEX "PortfolioDigest_accountId_environment_date_key" ON "PortfolioDigest"("accountId", "environment", "date");

-- CreateIndex
CREATE INDEX "PortfolioDigest_environment_idx" ON "PortfolioDigest"("environment");
