-- Second half of the two-PR column drop (docs/plans/PROD_DEPLOYMENT_PLAN.md).
-- #605's migration dropped this column while schema.prisma still declared it,
-- which broke every thesis write on 2026-09-08; the column was re-added by hand
-- to unbreak production, and #609 removed it from the schema. The deployed
-- client has not selected it since #609 went live, so dropping it now is safe.
ALTER TABLE "Thesis" DROP COLUMN IF EXISTS "targetSizePct";
