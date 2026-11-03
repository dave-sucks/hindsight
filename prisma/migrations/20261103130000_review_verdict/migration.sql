-- A review's verdict (one word and one line), and the earlier Activity line a note answers.
ALTER TABLE "ThesisUpdate" ADD COLUMN IF NOT EXISTS "verdict" TEXT;
ALTER TABLE "ThesisUpdate" ADD COLUMN IF NOT EXISTS "verdictLine" TEXT;
ALTER TABLE "ThesisUpdate" ADD COLUMN IF NOT EXISTS "answersUpdateId" TEXT;

CREATE INDEX IF NOT EXISTS "ThesisUpdate_answersUpdateId_idx" ON "ThesisUpdate"("answersUpdateId");

ALTER TABLE "ThesisUpdate" ADD CONSTRAINT "ThesisUpdate_answersUpdateId_fkey"
  FOREIGN KEY ("answersUpdateId") REFERENCES "ThesisUpdate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
