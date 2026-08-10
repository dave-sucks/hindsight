-- seed_position_size_floors.sql — set the per-seat position-size FLOOR.
--
-- STATUS: not yet run. Operator-run, AFTER the
-- 20260809000000_analyst_min_position_size migration is applied.
--
-- Context: `minPositionSize` ships defaulting to 0 (= no floor) so no analyst
-- starts refusing trades on deploy day. This script opts the three seats that
-- already carry PROSE floors in their `analystPrompt` into the real Layer-1
-- gate, using the same numbers those prose rules state:
--
--   PEAD Specialist      $7,000   (ceiling $14,000 — proposed a $3,566 HPE entry)
--   Catalyst Event PM    $5,000
--   Secular Compounder  $10,000   (ceiling $15,000 — opened a 1-share $922 LITE)
--
-- ⚠️  VERIFY BEFORE RUNNING. Analyst rows are matched by NAME, and the names
-- have churned (the 2026-05-27 migration renamed every seat). Run the SELECT
-- at the bottom first and confirm it returns exactly the three rows you mean,
-- with the ceilings you expect. Editing the floors in the analyst Settings UI
-- (Position Size Floor) does the same thing with no name-matching risk.
--
-- After this lands, trim the prose floor in each analyst's `analystPrompt`
-- down to a one-line restatement — the gate is the authority now, and a prose
-- rule that drifts from config is worse than no prose rule. See
-- docs/plans/ANALYST_LINEUP.md → "Position-size band".

BEGIN;

UPDATE "AgentConfig" SET "minPositionSize" = 7000
 WHERE name = 'PEAD Specialist' AND "minPositionSize" = 0;

UPDATE "AgentConfig" SET "minPositionSize" = 5000
 WHERE name = 'Catalyst Event PM' AND "minPositionSize" = 0;

UPDATE "AgentConfig" SET "minPositionSize" = 10000
 WHERE name = 'Secular Compounder' AND "minPositionSize" = 0;

-- Sanity: floor must never exceed the ceiling, or the seat can only ever place
-- one exact size (place_trade clamps the floor down to the ceiling rather than
-- deadlocking, but that is a misconfiguration signal, not a target state).
SELECT name,
       "tradingEnvironment",
       "minPositionSize" AS floor,
       "maxPositionSize" AS ceiling,
       "realMaxPosition" AS live_promotion_cap,
       ("minPositionSize" > "maxPositionSize") AS floor_above_ceiling
  FROM "AgentConfig"
 WHERE enabled = true
 ORDER BY name;

COMMIT;
