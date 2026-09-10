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
-- WHAT IT DOES:
--
--   1. On a WATCHING or PROMOTED row the rung is DROPPED. Always. A watch
--      does not gain a schedule it never had because of a predicate being
--      retired — that would hand names an Agent Watch nobody set, which is
--      the opposite of the point.
--   2. On a HELD row with no review cadence, it is REWRITTEN as a cadence of
--      the same length. That is the max-hold case: "this has been open N
--      days, look at it" is a real question about a live position, and the
--      cadence asks it and resets when someone answers.
--   3. On a HELD row that already has a cadence, it is DROPPED — two
--      cadences on one ladder is illegal under the one-trigger-per-bucket
--      rule, and the existing clock always asks sooner.
--   4. On a terminal row (PASSED / RETIRED) it is dropped outright.
--
-- An earlier draft converted on any row without a cadence, watch or held.
-- That was wider than intended and would have given five watches — BMRN,
-- CRWD, CSCO, PLTR, TOST — a review schedule they do not have today. Nothing
-- gains attention here; rows only lose a rung that no longer evaluates.
--
-- Verified against production 2026-09-09 — 180 rungs, every one action=REVIEW:
--   WATCHING  19    HOLDING 6    PASSED 6    RETIRED 149
--
-- Simulated against the live book. 25 live rows touched; none ends with two
-- cadences or a surviving rung, and NO row gains a schedule it lacks today.
--
--   CONVERTED — SMMT only. Held, no cadence, a 1-day rung its analyst wrote
--     for a binary catalyst. It becomes a 1-day review cadence, which is one
--     number in the popover if that is more than you want.
--   DROPPED — every other row. 19 watches lose a rung that no longer
--     evaluates; 8 of the 23 watches end up on no schedule at all (DOCU,
--     FIVE, HPE, PLTR, BMRN, CRWD, CSCO, TOST), and the 15 that are Agent
--     Watches today stay Agent Watches on the cadence they already carry.

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
          r->'predicate'->>'kind' = 'TIME_ELAPSED'
          AND (
            -- A watch never gains a schedule from this migration.
            t.status <> 'HOLDING'
            -- A template stamp is not anyone's schedule.
            OR r->>'source' = 'DEFAULT'
            -- A held row that already has a clock keeps the one it has.
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(t.triggers) x
              WHERE x->'predicate'->>'kind' = 'REVIEW_CADENCE'
            )
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
