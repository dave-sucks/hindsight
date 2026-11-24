-- The KPIs: one list of plain lines that tell us whether the belief is right,
-- in place of the two lists (what must stay true, and what would prove us
-- wrong) that described the same measures twice.
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "kpis" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Nothing is lost before the Writer rewrites each stock: its two old lists
-- are copied in as they are, the assumptions first. The old columns stay
-- until a later PR drops them.
UPDATE "Thesis"
SET "kpis" = COALESCE("keyAssumptions", ARRAY[]::TEXT[]) || COALESCE("invalidationConds", ARRAY[]::TEXT[])
WHERE cardinality("kpis") = 0
  AND (cardinality("keyAssumptions") > 0 OR cardinality("invalidationConds") > 0);
