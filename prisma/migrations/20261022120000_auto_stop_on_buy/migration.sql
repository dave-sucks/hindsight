-- Stop when buying: a new holding's floor a percent under its buy price.
-- The account's setting; an analyst's null columns mean "use the account's".
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "autoStopOnBuy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "autoStopPct" DOUBLE PRECISION NOT NULL DEFAULT 8;
ALTER TABLE "AgentConfig" ADD COLUMN IF NOT EXISTS "autoStopOnBuy" BOOLEAN;
ALTER TABLE "AgentConfig" ADD COLUMN IF NOT EXISTS "autoStopPct" DOUBLE PRECISION;
