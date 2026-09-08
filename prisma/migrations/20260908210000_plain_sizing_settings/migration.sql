-- Sizing is three plain settings: smallest trade, largest trade, most in one
-- stock. See lib/agent/position-sizing.ts.
--
-- Fold the LIVE-only "promotion cap" into the largest trade where it was the
-- binding number (one analyst), then delete it. The hidden ×2 add multiple
-- becomes an explicit per-analyst value, backfilled with what it was.

ALTER TABLE "AgentConfig" ADD COLUMN "maxPositionTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "AgentConfig"
SET "maxPositionSize" = "realMaxPosition"
WHERE "tradingEnvironment" = 'LIVE'
  AND "realMaxPosition" > 0
  AND "realMaxPosition" < "maxPositionSize";

UPDATE "AgentConfig" SET "maxPositionTotal" = "maxPositionSize" * 2;

ALTER TABLE "AgentConfig" DROP COLUMN "realMaxPosition";
