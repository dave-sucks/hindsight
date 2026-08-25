-- Review cadence, by strategy (DAV-195 L7).
--
-- WITHOUT THIS, L7 SILENTLY STOPS ALL REVIEWS. The review clock moved from a
-- date column to a "review every N days" trigger, and computeNeedsAction now
-- looks for that trigger to raise REVIEW_DUE. accountSeedTriggers() includes
-- one, but only for accounts that have never been seeded, and every existing
-- account has `triggersSeededAt` set. Net effect on deploy: no cadence
-- anywhere, REVIEW_DUE never fires, and the daily run quietly reviews
-- nothing. No error.
--
-- HOW OFTEN IS A PROPERTY OF THE STRATEGY, NOT THE ACCOUNT. A compounder and
-- a two-week trade do not review on the same clock — that is what the old
-- HORIZON_REVIEW_DAYS table encoded, and dropping it onto one account-wide
-- number would have reviewed 5 catalysts 7x less often and 15 compounders 4x
-- more. So this seeds two levels:
--
--   ACCOUNT  every 7 days   — the floor, inherited by anything unspecified
--   THESIS   per horizon    — CATALYST 1, TRADE 1, COMPOUNDER 30
--
-- TARGET theses get nothing of their own: 7 days is already the account rule,
-- and a redundant copy would freeze a snapshot of a level that should stay
-- inherited.
--
-- Known follow-up: a thesis promoted between horizons keeps the cadence it
-- was minted with. Same drift every horizon-derived trigger already has; the
-- level is visible and editable on the sheet, which is the point.

-- ── Account floor ────────────────────────────────────────────────────────
UPDATE "Account"
SET triggers = COALESCE(triggers, '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object(
    'id',           gen_random_uuid()::text,
    'predicate',    jsonb_build_object('kind', 'REVIEW_CADENCE', 'days', 7),
    'action',       'REVIEW',
    'rationale',    'Look at this every 7 days, counting from the last real review.',
    'cooldownDays', 7,
    'fireMode',     'TACTICAL',
    'source',       'DEFAULT'
  )
)
WHERE triggers::text NOT LIKE '%REVIEW_CADENCE%';

-- ── Per-thesis, where the strategy wants something other than 7 ──────────
UPDATE "Thesis" t
SET triggers = COALESCE(t.triggers, '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object(
    'id',           gen_random_uuid()::text,
    'predicate',    jsonb_build_object('kind', 'REVIEW_CADENCE', 'days', d.days),
    'action',       'REVIEW',
    'rationale',    CASE WHEN d.days = 1
                      THEN 'Look at this every day.'
                      ELSE 'Look at this every ' || d.days || ' days, counting from the last real review.' END,
    'cooldownDays', d.days,
    'fireMode',     'TACTICAL',
    'source',       'DEFAULT'
  )
)
FROM (VALUES ('CATALYST', 1), ('TRADE', 1), ('COMPOUNDER', 30)) AS d(horizon, days)
WHERE t.horizon = d.horizon
  AND t.status IN ('HOLDING', 'WATCHING')
  AND t.triggers::text NOT LIKE '%REVIEW_CADENCE%';
