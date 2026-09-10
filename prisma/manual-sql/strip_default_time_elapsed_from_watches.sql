-- strip_default_time_elapsed_from_watches.sql — remove the time-elapsed
-- review rungs the WATCHING templates invented (DAV-209).
--
-- STATUS: not yet run. Operator-run, any time after the PR that stops the
-- templates emitting these lands. Safe to run more than once.
--
-- Context: every WATCHING horizon template used to append a
-- `TIME_ELAPSED` REVIEW rung the thesis's author never asked for — 14 days
-- on CATALYST/TRADE, 30 on TARGET, 90 on COMPOUNDER. The templates no
-- longer do. This clears the ones already on the book so a name's ladder
-- is what its author wrote and nothing else.
--
-- SCOPE — deliberately narrow, twice over:
--
--   * WATCHING rows only. A held position's max-hold review is a different
--     question and is not touched here.
--   * `source = 'DEFAULT'` only. That is the template's own stamp. An
--     agent that CHOSE a time-elapsed review wrote `source = 'AGENT'`, and
--     those are its judgment, not the template's default — ETN (365 days),
--     GD (180), SYK (60), PLTR (90) and eleven others stay exactly as they
--     are.
--
-- Verified against production 2026-09-09: 19 WATCHING rows carry a
-- TIME_ELAPSED rung. 15 are AGENT-written and survive. 4 are DEFAULT and
-- are removed by this script:
--
--   AGIO   14 days
--   DOCU   30 days
--   FIVE   30 days
--   HPE    30 days
--
-- (An earlier count of "8" was a different measure — watches carrying a
-- time-elapsed rung and no review cadence — not the DEFAULT-source set.)
--
-- Rows keep every other rung. A row whose ONLY trigger was this one ends up
-- with an empty ladder, which is legal: nothing reviews it until someone
-- puts a review cadence on it or a level fires.

BEGIN;

-- What will change, for the record before it changes.
SELECT t.ticker,
       (r->'predicate'->>'days')::int AS days
FROM "Thesis" t, jsonb_array_elements(t.triggers) r
WHERE t.status = 'WATCHING'
  AND r->'predicate'->>'kind' = 'TIME_ELAPSED'
  AND r->>'source' = 'DEFAULT'
ORDER BY t.ticker;

UPDATE "Thesis" t
SET triggers = COALESCE(
      (
        SELECT jsonb_agg(r)
        FROM jsonb_array_elements(t.triggers) r
        WHERE NOT (
          r->'predicate'->>'kind' = 'TIME_ELAPSED'
          AND r->>'source' = 'DEFAULT'
        )
      ),
      '[]'::jsonb
    ),
    "updatedAt" = now()
WHERE t.status = 'WATCHING'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(t.triggers) r
    WHERE r->'predicate'->>'kind' = 'TIME_ELAPSED'
      AND r->>'source' = 'DEFAULT'
  );

-- Should return zero rows.
SELECT t.ticker
FROM "Thesis" t, jsonb_array_elements(t.triggers) r
WHERE t.status = 'WATCHING'
  AND r->'predicate'->>'kind' = 'TIME_ELAPSED'
  AND r->>'source' = 'DEFAULT';

COMMIT;
