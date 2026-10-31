-- A new analyst's defaults, the same as NEW_ANALYST_DEFAULTS in
-- lib/analyst-settings.ts. Defaults only: the columns the code no longer
-- reads are dropped in a later migration, once this code is live.
ALTER TABLE "AgentConfig" ALTER COLUMN "minPositionSize" SET DEFAULT 3000,
ALTER COLUMN "maxPositionSize" SET DEFAULT 8000,
ALTER COLUMN "minConfidence" SET DEFAULT 60,
ALTER COLUMN "holdDurations" SET DEFAULT ARRAY['SWING']::TEXT[],
ALTER COLUMN "directionBias" SET DEFAULT 'LONG';
