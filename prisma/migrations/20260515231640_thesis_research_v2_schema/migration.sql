-- Thesis Research V2 — schema-only changes. See docs/plans/THESIS_RESEARCH_V2.md §7.
-- All additive, all nullable. No existing rows or queries break.

-- AlterTable
ALTER TABLE "Thesis"
  ADD COLUMN "researchData"      JSONB,
  ADD COLUMN "researchSections"  JSONB,
  ADD COLUMN "researchUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN "parentRunId" TEXT;

-- CreateIndex
CREATE INDEX "ResearchRun_parentRunId_idx" ON "ResearchRun"("parentRunId");

-- AddForeignKey
ALTER TABLE "ResearchRun"
  ADD CONSTRAINT "ResearchRun_parentRunId_fkey"
  FOREIGN KEY ("parentRunId") REFERENCES "ResearchRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
