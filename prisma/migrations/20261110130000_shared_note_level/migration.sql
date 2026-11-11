-- Each stock a note names gets its own level, ticker → CONTEXT (its next
-- review reads it), REVIEW (it goes on its analyst's next run until a run
-- writes on it), URGENT (a run starts on it) or PROPOSAL (about the sale
-- waiting on it, shown on that proposal's card). A stock not listed, and
-- every note to an analyst or the account, is CONTEXT. lib/agent/shared-notes.ts.
ALTER TABLE "SharedNote" ADD COLUMN IF NOT EXISTS "levels" JSONB NOT NULL DEFAULT '{}';
