-- Hotfix: duplicate-route eliminator + prevention.
--
-- PR #173's "Bug 2b fix" removed the `routes: { none: {} }` filter from
-- signal-router.ts on the assumption that a UNIQUE (analystId, signalId)
-- constraint existed and `skipDuplicates: true` on createMany would dedupe.
-- The constraint did not exist. As a result, the signal-router — which
-- fires multiple times per day (cron + `intelligence/route-signals` event
-- per batch) — created a fresh set of routes on every invocation.
--
-- Result (Apr 23-24): ~1,500 duplicate routes per day, 7-8x row inflation.
-- Every "TMT had 240 routes today" metric was actually ~30 unique routes.
--
-- Dedupe step (the prod DB has already been manually deduped; this SQL
-- is idempotent so re-running during apply is safe):
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "analystId", "signalId"
      ORDER BY
        CASE status
          WHEN 'ACTED_ON' THEN 0
          WHEN 'READ' THEN 1
          WHEN 'PENDING' THEN 2
          ELSE 3
        END,
        "relevanceScore" DESC,
        "routedAt" DESC
    ) AS rn
  FROM "AnalystSignalRoute"
)
DELETE FROM "AnalystSignalRoute"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Prevention: add the unique constraint so `skipDuplicates: true` on
-- createMany actually works going forward.
ALTER TABLE "AnalystSignalRoute"
  ADD CONSTRAINT "AnalystSignalRoute_analystId_signalId_key"
  UNIQUE ("analystId", "signalId");
