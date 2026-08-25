-- Review cadence becomes a trigger (DAV-195 L7).
--
-- `nextReviewAt` stops being a date the agent sets and becomes a derived
-- display cache. The authority moves to a REVIEW_CADENCE trigger on the
-- ladder, which counts from when the thesis was last actually reviewed —
-- so we need to record that, which nothing did before.
ALTER TABLE "Thesis" ADD COLUMN IF NOT EXISTS "lastReviewedAt" TIMESTAMP(3);

-- Seed it from the audit log: the most recent row where an analyst actually
-- looked at the thesis. Without this every thesis reads as never-reviewed on
-- the first tick after deploy and the whole book comes due at once.
UPDATE "Thesis" t
SET "lastReviewedAt" = sub.ts
FROM (
  SELECT "thesisId", MAX("timestamp") AS ts
  FROM "ThesisUpdate"
  WHERE type IN ('REVIEWED', 'UPDATED', 'STATUS_CHANGED')
  GROUP BY "thesisId"
) sub
WHERE t.id = sub."thesisId" AND t."lastReviewedAt" IS NULL;

-- Anything with no audit history at all falls back to when it was created,
-- which is the same clock the old WATCHING-side cadence used.
UPDATE "Thesis" SET "lastReviewedAt" = "createdAt" WHERE "lastReviewedAt" IS NULL;
