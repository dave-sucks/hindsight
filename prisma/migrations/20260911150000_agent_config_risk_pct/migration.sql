-- DAV-251: one sizing setting — risk per trade, % of equity. Default 1% (DAV-245 ruling 2).
-- maxRiskPct (an orphan nothing ever read) leaves schema.prisma in this PR;
-- its column is dropped in a follow-up (the two-PR column rule).
ALTER TABLE "AgentConfig" ADD COLUMN IF NOT EXISTS "riskPct" DOUBLE PRECISION NOT NULL DEFAULT 1;
