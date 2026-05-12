-- Per-analyst paper→live promotion: environment columns across the trade graph.
--
-- Adds a PAPER|LIVE environment tag to:
--   - AgentConfig.tradingEnvironment   (replaces realTradingEnabled)
--   - ResearchRun.environment           (snapshot at run creation)
--   - Position.environment              (snapshot at place_trade)
--   - Order.environment                 (mirror of Position)
--   - UserApiKey.environment            (one PAPER + one LIVE row per user)
--
-- Drops:
--   - AgentConfig.realTradingEnabled    (never wired, replaced by tradingEnvironment)
--   - UserApiKey.paperMode              (replaced by environment)
--
-- See docs/PROD_DEPLOYMENT_PLAN.md.

-- ─── AgentConfig ────────────────────────────────────────────────────────────
ALTER TABLE "AgentConfig" ADD COLUMN "tradingEnvironment" TEXT NOT NULL DEFAULT 'PAPER';
ALTER TABLE "AgentConfig" DROP COLUMN "realTradingEnabled";

-- ─── ResearchRun ────────────────────────────────────────────────────────────
ALTER TABLE "ResearchRun" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'PAPER';
CREATE INDEX "ResearchRun_agentConfigId_environment_idx" ON "ResearchRun"("agentConfigId", "environment");

-- ─── Position ───────────────────────────────────────────────────────────────
ALTER TABLE "Position" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'PAPER';
CREATE INDEX "Position_analystId_environment_status_idx" ON "Position"("analystId", "environment", "status");

-- ─── Order ──────────────────────────────────────────────────────────────────
ALTER TABLE "Order" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'PAPER';

-- ─── UserApiKey ─────────────────────────────────────────────────────────────
-- Add environment column, backfill from paperMode, then flip the unique key.
ALTER TABLE "UserApiKey" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'PAPER';
UPDATE "UserApiKey" SET "environment" = CASE WHEN "paperMode" THEN 'PAPER' ELSE 'LIVE' END;
ALTER TABLE "UserApiKey" DROP CONSTRAINT "UserApiKey_userId_provider_key";
ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_userId_provider_environment_key" UNIQUE ("userId", "provider", "environment");
ALTER TABLE "UserApiKey" DROP COLUMN "paperMode";
