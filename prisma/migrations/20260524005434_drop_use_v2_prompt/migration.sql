-- Drop the dead useV2Prompt rollout flag from AgentConfig.
--
-- The flag existed to gate the V2 daily-run prompt rollout per-analyst
-- (docs/plans/MORNING_RUN_V2_DESIGN.md). PR #270 deprecated the V1
-- builder and made route.ts call buildDailyRunSystemPromptV2
-- unconditionally; morning-research.ts already ignores the flag. The
-- column has been read by zero code paths since 2026-05-16. All 6
-- production analysts have `useV2Prompt = true` so dropping it is
-- value-preserving.
--
-- P2-17 in docs/GAPS.md.

ALTER TABLE "AgentConfig" DROP COLUMN "useV2Prompt";
