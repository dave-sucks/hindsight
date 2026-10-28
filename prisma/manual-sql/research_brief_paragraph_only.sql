-- research_brief_paragraph_only.sql — strip every stored research brief to
-- its paragraph and sources.
--
-- STATUS: not yet run. Operator-run, after the deploy that stores briefs as
-- one paragraph (version 2, lib/research/brief-types.ts).
--
-- Context: from 2026-10-22 to 2026-10-28 each brief stored ~100 values (why
-- it moved, analyst actions, targets, rating counts, company news,
-- fundamentals, our numbers, an X search that never ran, the failures). The
-- card, the email and the agents now read only the paragraph and its
-- sources; this removes the rest from the old rows. The `error` column keeps
-- what failed, for us.
--
-- Idempotent: a row already down to the paragraph has none of the old keys.

UPDATE "ResearchBrief"
SET payload = jsonb_build_object(
  'version', COALESCE(payload->'version', '1'::jsonb),
  'ticker', payload->'ticker',
  'company', payload->'company',
  'kind', payload->'kind',
  'builtAt', payload->'builtAt',
  'synthesis', payload->'synthesis',
  'sources', COALESCE(payload->'sources', '[]'::jsonb)
)
WHERE payload ?| ARRAY['numbers', 'whyItMoved', 'analystActions', 'targets', 'ratings', 'companyNews', 'fundamentals', 'social', 'failures'];
