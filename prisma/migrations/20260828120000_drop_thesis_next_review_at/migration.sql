-- DAV-221: delete Thesis.nextReviewAt — the review clock has one home.
--
-- The column was a cached copy of "lastReviewedAt + the review cadence".
-- It froze once when its writers were deleted (DAV-195 L7) and every thesis
-- past its last written date read as overdue forever (fixed in #563 by
-- re-deriving it; deleted here so the bug class is no longer expressible).
-- Every surface now derives the date at read time via
-- lib/agent/triggers/defaults.ts (nextReviewFrom / derivedNextReviewAt).

DROP INDEX IF EXISTS "Thesis_status_nextReviewAt_idx";

ALTER TABLE "Thesis" DROP COLUMN IF EXISTS "nextReviewAt";
