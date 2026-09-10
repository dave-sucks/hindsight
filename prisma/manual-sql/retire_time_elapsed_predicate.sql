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
--   1. A rung stamped source='DEFAULT' is DROPPED, always, cadence or no
--      cadence. That is a template stamp, not a schedule anyone chose —
--      the exact thing this whole change exists to stop. Carrying it
--      forward would hand three watches minted this morning a monthly
--      review nobody asked for. They come out as free watches; put a
--      schedule on them by hand if they earn one.
--   2. Otherwise, on a LIVE row (HOLDING / WATCHING / PROMOTED) with NO
--      review cadence, the time-elapsed REVIEW is REWRITTEN as a
--      REVIEW_CADENCE of the same length. An analyst wrote "come back to
--      this in N days" and still gets it; it now resets when someone looks.
--   3. On a live row that ALREADY carries a cadence, the rung is DROPPED.
--      Two cadences on one ladder is not a schedule, it is a race — and
--      under the one-trigger-per-bucket rule it is illegal outright. The
--      surviving clock always asks sooner anyway.
--   4. On a terminal row (PASSED / RETIRED) it is dropped outright. Nothing
--      evaluates history.
--
-- Note on rule 1: only an EXPLICIT 'DEFAULT' counts as a template stamp. One
-- legacy row (CEG) carries no source field at all; it has a cadence, so rule
-- 3 drops it regardless, and there is no row today where the distinction
-- changes the outcome.
--
-- Verified against production 2026-09-09 — 180 rungs, every one action=REVIEW:
--   WATCHING  19    HOLDING 6    PASSED 6    RETIRED 149
--
-- Simulated against the live book. 25 live rows touched; none ends with two
-- cadences or a surviving time-elapsed rung.
--
--   CONVERTED — six schedules an analyst actually wrote, on rows with no
--     clock: BMRN 120 ("entry window opens in January"), CRWD 85 and
--     TOST 63 (next earnings print), CSCO 40 (window closes Oct 11),
--     PLTR 90 ("re-read at 90 days"), SMMT 1 (daily through a binary
--     catalyst — that is what its analyst wrote, and one number in the
--     popover if it is more than you want).
--   DROPPED as template stamps (rule 1) — DOCU 30, FIVE 30, HPE 30, minted
--     this morning and never chosen by anyone. They become free watches.
--   DROPPED because a tighter clock already exists (rule 3) — ABT, AGIO,
--     ASML, BWXT, CEG, CYTK, ETN, GD, GEV, ISRG, MIRM, NOW, NVDA, PBH,
--     SYK, WST. ETN loses a 365-day rung to a 30-day clock, GD 180 to 30,
--     SYK 60 to 30 — the clock that stays reviews each of them sooner.
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
          r->'predicate'->>'kind' = 'TIME_ELAPSED'
          AND (
            -- A template stamp is not the author's schedule. Never carry it
            -- forward, cadence or no cadence.
            r->>'source' = 'DEFAULT'
            -- Otherwise: drop rather than rewrite when a clock already exists.
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
