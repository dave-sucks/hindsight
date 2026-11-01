-- Second half of the two-PR column drop (docs/plans/PROD_DEPLOYMENT_PLAN.md).
-- #903 removed these 21 AgentConfig fields from schema.prisma and from every
-- reader and writer: nothing read them. Checked 2026-10-31 against production:
-- all 21 columns still exist, and no view, policy or index depends on them.
ALTER TABLE "AgentConfig" DROP COLUMN IF EXISTS "analystVoice",
DROP COLUMN IF EXISTS "conceptPromptExtra",
DROP COLUMN IF EXISTS "dailyLossLimit",
DROP COLUMN IF EXISTS "digestEmail",
DROP COLUMN IF EXISTS "exchanges",
DROP COLUMN IF EXISTS "graduationProfitFactor",
DROP COLUMN IF EXISTS "industries",
DROP COLUMN IF EXISTS "intelligencePolicy",
DROP COLUMN IF EXISTS "markets",
DROP COLUMN IF EXISTS "minMarketCapTier",
DROP COLUMN IF EXISTS "priceCheckFreq",
DROP COLUMN IF EXISTS "scheduleTime",
DROP COLUMN IF EXISTS "signalTypes",
DROP COLUMN IF EXISTS "strategyInstructions",
DROP COLUMN IF EXISTS "strategyType",
DROP COLUMN IF EXISTS "themes",
DROP COLUMN IF EXISTS "thesisPromptExtra",
DROP COLUMN IF EXISTS "tickerUniverse",
DROP COLUMN IF EXISTS "tradePolicyAutoTrade",
DROP COLUMN IF EXISTS "weekendMode",
DROP COLUMN IF EXISTS "weeklyDigestEnabled";
