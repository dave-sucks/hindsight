-- WATCHING cadence opt-in (DAV-216, W1 of the watchlist work).
--
-- resolveLadder now gates inherited REVIEW_CADENCE on WATCHING theses: a
-- watch item is reviewed iff it carries its own cadence trigger. That is
-- what makes a "soft watch" (wakes on events, costs no review attention)
-- representable — but four live WATCHING rows were riding the ACCOUNT's
-- inherited 7d clock with no rung of their own (all PEAD, horizon TARGET:
-- the L7 seed stamped CATALYST/TRADE/COMPOUNDER watches explicitly and
-- deliberately left TARGET to the account floor). Without this seed, the
-- resolver gate silently takes them off the review clock — the exact
-- "reviews stop, no error" failure the L7 seed migration warned about.
--
-- Stamp: days=7, matching both the account floor they ride today and
-- CADENCE_DAYS_BY_HORIZON.TARGET. Guard is the same idiom as the L7 seed.
-- New mints stamp their own cadence in record_thesis from now on; this is
-- only the backfill for rows minted between L7 and W1.
UPDATE "Thesis" t
SET triggers = COALESCE(t.triggers, '[]'::jsonb) || jsonb_build_array(
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
WHERE t.status = 'WATCHING'
  AND t.triggers::text NOT LIKE '%REVIEW_CADENCE%';
