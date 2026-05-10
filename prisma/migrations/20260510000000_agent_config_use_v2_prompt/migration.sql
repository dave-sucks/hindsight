-- Per-analyst V2 prompt rollout flag.
--
-- Adds AgentConfig.useV2Prompt (default false). Drives the V1-vs-V2
-- branch in lib/inngest/functions/morning-research.ts so we can flip
-- one analyst at a time and watch for regressions.
--
-- See docs/MORNING_RUN_V2_DESIGN.md → Rollout. Once every enabled
-- analyst has been on V2 for ~7 trading days without regression, the
-- V1 builder + this column come out (separate migration).

ALTER TABLE "AgentConfig" ADD COLUMN "useV2Prompt" BOOLEAN NOT NULL DEFAULT false;
