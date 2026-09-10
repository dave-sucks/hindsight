-- retire_time_elapsed_predicate.sql — TIME_ELAPSED no longer exists.
--
-- STATUS: not yet run. Operator-run, AFTER the PR that deletes the predicate
-- from the code is deployed. Safe to run more than once.
--
-- Context: there were two ways to say "look at this after N days".
-- REVIEW_CADENCE counts from the last real review, so answering it resets it.
-- TIME_ELAPSED counted from when the row was created, so it went true once
-- and then nagged on its cooldown forever, no matter how many times anyone
-- looked. The code now has one, and this brings the book with it.
--
-- The evaluator no longer understands TIME_ELAPSED. A rung left behind would
-- be parsed, found unrecognised, and silently dropped at evaluation — a
-- schedule that looks real on screen and fires nothing. That is why this runs
-- rather than leaving the rows to rot.
--
-- WHAT IT DOES, and why it is not a blanket delete:
--
--   1. On a LIVE row (HOLDING / WATCHING / PROMOTED) a time-elapsed REVIEW is
--      REWRITTEN as a REVIEW_CADENCE of the same length. The author meant
--      "come back to this in N days" and still gets that; it now resets when
--      someone actually looks. This covers the held max-hold rungs and the
--      agent-written watch schedules alike (ETN 365, GD 180, SYK 60, PLTR 90
--      and the rest keep their intervals).
--   2. Unless the row ALREADY carries a REVIEW_CADENCE — then the rung is
--      dropped instead. Two clocks on one ladder is not a schedule, it is a
--      race, and the resolver would silently pick whichever came first.
--   3. On a terminal row (PASSED / RETIRED) it is dropped outright. Nothing
--      evaluates history.
--
-- Verified against production 2026-09-09 — 180 rungs, every one action=REVIEW:
--   WATCHING  19    HOLDING 6    PASSED 6    RETIRED 149
--
-- Rows keep every other rung. A row whose only trigger was this one and which
-- already had a cadence simply loses the duplicate.

BEGIN;

-- Before.
SELECT t.status, count(*) AS rungs
FROM "Thesis" t, jsonb_array_elements(t.triggers) r
WHERE r->'predicate'->>'kind' = 'TIME_ELAPSED'
GROUP BY t.status ORDER BY t.status;

-- 1 + 2. Live rows: rewrite to a cadence, or drop when one already exists.
UPDATE "Thesis" t
SET triggers = (
      SELECT COALESCE(jsonb_agg(out), '[]'::jsonb)
      FROM (
        SELECT CASE
                 WHEN r->'predicate'->>'kind' <> 'TIME_ELAPSED' THEN r
                 ELSE jsonb_set(
                        r,
                        '{predicate}',
                        jsonb_build_object(
                          'kind', 'REVIEW_CADENCE',
                          'days', (r->'predicate'->>'days')::int
                        )
                      )
                      || jsonb_build_object(
                           'cooldownDays', (r->'predicate'->>'days')::int
                         )
               END AS out
        FROM jsonb_array_elements(t.triggers) r
        WHERE NOT (
          -- drop rather than rewrite when the row already has a clock
          r->'predicate'->>'kind' = 'TIME_ELAPSED'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(t.triggers) x
            WHERE x->'predicate'->>'kind' = 'REVIEW_CADENCE'
          )
        )
      ) s
    ),
    "updatedAt" = now()
WHERE t.status IN ('HOLDING', 'WATCHING', 'PROMOTED')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.triggers) r
    WHERE r->'predicate'->>'kind' = 'TIME_ELAPSED'
  );

-- 3. Terminal rows: drop outright.
UPDATE "Thesis" t
SET triggers = COALESCE(
      (
        SELECT jsonb_agg(r)
        FROM jsonb_array_elements(t.triggers) r
        WHERE r->'predicate'->>'kind' <> 'TIME_ELAPSED'
      ),
      '[]'::jsonb
    ),
    "updatedAt" = now()
WHERE t.status NOT IN ('HOLDING', 'WATCHING', 'PROMOTED')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.triggers) r
    WHERE r->'predicate'->>'kind' = 'TIME_ELAPSED'
  );

-- Should return zero rows.
SELECT t.id, t.ticker, t.status
FROM "Thesis" t, jsonb_array_elements(t.triggers) r
WHERE r->'predicate'->>'kind' = 'TIME_ELAPSED';

-- No live row should now carry two clocks.
SELECT t.ticker, count(*) AS clocks
FROM "Thesis" t, jsonb_array_elements(t.triggers) r
WHERE t.status IN ('HOLDING', 'WATCHING', 'PROMOTED')
  AND r->'predicate'->>'kind' = 'REVIEW_CADENCE'
GROUP BY t.ticker HAVING count(*) > 1;

COMMIT;
