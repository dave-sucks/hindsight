-- Give every existing account the review cadence (DAV-195 L7).
--
-- WITHOUT THIS, L7 SILENTLY STOPS ALL REVIEWS. The review clock moved from a
-- date column to a "review every N days" trigger, and computeNeedsAction now
-- looks for that trigger to raise REVIEW_DUE. accountSeedTriggers() includes
-- one — but only for accounts that have never been seeded, and every existing
-- account has `triggersSeededAt` set (deliberately: a seeded account's array
-- is authoritative, so emptying it can't resurrect the defaults).
--
-- Net effect on a live account: no cadence anywhere, REVIEW_DUE never fires,
-- and the daily run quietly reviews nothing that isn't otherwise flagged.
--
-- 7 days is the TARGET-horizon default the old HORIZON_REVIEW_DAYS table
-- used. A tighter horizon overrides it through the normal cascade.
UPDATE "Account"
SET triggers = COALESCE(triggers, '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object(
    'id',            gen_random_uuid()::text,
    'predicate',     jsonb_build_object('kind', 'REVIEW_CADENCE', 'days', 7),
    'action',        'REVIEW',
    'rationale',     'Look at this every 7 days, counting from the last real review.',
    'cooldownDays',  7,
    'fireMode',      'TACTICAL',
    'source',        'DEFAULT'
  )
)
WHERE triggers::text NOT LIKE '%REVIEW_CADENCE%';
