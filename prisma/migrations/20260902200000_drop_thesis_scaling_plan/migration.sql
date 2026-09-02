-- Delete Thesis.scalingPlan — a structured column nothing read.
--
-- Authored via record_thesis / update_thesis, stored on 69 theses (10 of
-- them live), selected into the tactical run's thesis object and declared
-- in its prompt input type — and never rendered into any prompt, never
-- validated, never connected to place_trade. Scaling in was writable and
-- inert. The ladder already has the real shape for it: an ADD rung.
-- (docs/audits/2026-09-02-thesis-pipeline-audit.md, "needlessly
-- complicated" #5.)

ALTER TABLE "Thesis" DROP COLUMN IF EXISTS "scalingPlan";
