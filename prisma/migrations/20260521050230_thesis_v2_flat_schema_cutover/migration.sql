-- THESIS_CLEANUP PR-9 — flat-schema cutover for the V2 deep-research thesis-writer.
--
-- Replaces the `researchSections` JSONB blob (PR-1 migration) with 9
-- first-class JSONB columns. Three of them are rename + retypes of existing
-- narrative fields:
--   reasoningSummary (String)  → snapshot   (Json { text, citations })
--   thesisBullets    (String[])→ bullCase   (Json { bullets[{text, citation}] })
--   riskFlags        (String[])→ bearCase   (Json { bullets[{text, citation}] })
--
-- Six new sections that didn't have a column before:
--   recentCatalysts, fundamentals, latestEarnings, catalystsAndEvents,
--   analystConsensus, insiderTechnical.
--
-- Drops the three consolidation candidates:
--   confidenceScore (replaced by scoring.composite)
--   signalTypes     (derivable from sourceSignalIds)
--   sourcesUsed     (per-section citations cover it)
--
-- Drops the researchSections blob — flat columns supersede.
--
-- Legacy rows retain their content: the rename + retype wraps the existing
-- value in {text, citations: []} / {bullets: [{text}]} so the sheet renders.
-- When the V2 thesis-writer refreshes a thesis it overwrites with the rich
-- citations.

-- Rename + retype: reasoningSummary (String) → snapshot (Json)
ALTER TABLE "Thesis" ADD COLUMN "snapshot" JSONB;
UPDATE "Thesis"
  SET "snapshot" = jsonb_build_object(
    'text',      "reasoningSummary",
    'citations', '[]'::jsonb
  )
  WHERE "reasoningSummary" IS NOT NULL AND "reasoningSummary" <> '';
ALTER TABLE "Thesis" DROP COLUMN "reasoningSummary";

-- Rename + retype: thesisBullets (String[]) → bullCase (Json)
ALTER TABLE "Thesis" ADD COLUMN "bullCase" JSONB;
UPDATE "Thesis"
  SET "bullCase" = jsonb_build_object(
    'bullets',
    (SELECT jsonb_agg(jsonb_build_object('text', b)) FROM unnest("thesisBullets") AS b)
  )
  WHERE "thesisBullets" IS NOT NULL AND array_length("thesisBullets", 1) > 0;
ALTER TABLE "Thesis" DROP COLUMN "thesisBullets";

-- Rename + retype: riskFlags (String[]) → bearCase (Json)
ALTER TABLE "Thesis" ADD COLUMN "bearCase" JSONB;
UPDATE "Thesis"
  SET "bearCase" = jsonb_build_object(
    'bullets',
    (SELECT jsonb_agg(jsonb_build_object('text', b)) FROM unnest("riskFlags") AS b)
  )
  WHERE "riskFlags" IS NOT NULL AND array_length("riskFlags", 1) > 0;
ALTER TABLE "Thesis" DROP COLUMN "riskFlags";

-- 6 new nullable section columns (no backfill — null until V2 refreshes
-- the thesis).
ALTER TABLE "Thesis"
  ADD COLUMN "recentCatalysts"    JSONB,
  ADD COLUMN "fundamentals"       JSONB,
  ADD COLUMN "latestEarnings"     JSONB,
  ADD COLUMN "catalystsAndEvents" JSONB,
  ADD COLUMN "analystConsensus"   JSONB,
  ADD COLUMN "insiderTechnical"   JSONB;

-- Drop the blob field added by THESIS_RESEARCH_V2 schema migration.
ALTER TABLE "Thesis" DROP COLUMN "researchSections";

-- Drop the consolidation candidates.
ALTER TABLE "Thesis"
  DROP COLUMN "confidenceScore",
  DROP COLUMN "signalTypes",
  DROP COLUMN "sourcesUsed";
