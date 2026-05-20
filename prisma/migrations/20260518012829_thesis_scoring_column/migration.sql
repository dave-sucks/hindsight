-- Thesis Cleanup PR-1 — promote 4-dim composite scoring from the legacy
-- `fullResearch` JSONB nesting to a first-class top-level column. See
-- docs/plans/THESIS_CLEANUP.md.
--
-- Shape (new):  Thesis.scoring = {
--   trendStrength:     { score, note },
--   relativeStrength:  { score, note },
--   entryQuality:      { score, note },
--   catalystFreshness: { score, note },
--   composite:         number  // formerly Thesis.fullResearch.scoringComposite
-- }
--
-- Backfill copies the 4-dim block out of `fullResearch.scoring` and folds
-- `fullResearch.scoringComposite` in as `composite`. Rows without scoring
-- in fullResearch stay null on the new column — the reader still falls
-- back to the legacy path during the soak. `fullResearch` column itself is
-- dropped in PR-4 once every writer has switched to `scoring`.

-- AlterTable
ALTER TABLE "Thesis" ADD COLUMN "scoring" JSONB;

-- Backfill — for every row with a non-empty fullResearch.scoring block,
-- materialize the new shape. jsonb_build_object preserves nulls cleanly.
UPDATE "Thesis"
SET "scoring" = jsonb_build_object(
    'trendStrength',     "fullResearch" -> 'scoring' -> 'trendStrength',
    'relativeStrength',  "fullResearch" -> 'scoring' -> 'relativeStrength',
    'entryQuality',      "fullResearch" -> 'scoring' -> 'entryQuality',
    'catalystFreshness', "fullResearch" -> 'scoring' -> 'catalystFreshness',
    'composite',         "fullResearch" -> 'scoringComposite'
  )
WHERE "fullResearch" IS NOT NULL
  AND jsonb_typeof("fullResearch" -> 'scoring') = 'object';
