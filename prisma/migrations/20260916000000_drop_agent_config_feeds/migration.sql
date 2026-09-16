-- Second half of the two-PR column drop (docs/plans/PROD_DEPLOYMENT_PLAN.md).
-- #637 (live since 2026-09-13) removed `feeds` from schema.prisma and from
-- every reader and writer: the subscription it carried routed the movers and
-- earnings-calendar firehose into an inbox nothing has read since 2026-05-31.
-- The deployed client has not selected the column since then, so dropping it
-- now is safe. Verified 2026-09-15 against production: the column still
-- exists, default '{}', and `git grep feeds` finds no code that names it.
ALTER TABLE "AgentConfig" DROP COLUMN IF EXISTS "feeds";
