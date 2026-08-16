-- Standing trigger rules become DATA on the account, not code constants.
--
-- The universal minimums (±7% scale-ins, +10% gain checkpoint, 8% trail,
-- −12% loser review) used to resolve as a fourth cascade level beneath
-- ACCOUNT: visible but permanently uneditable, changeable only by deploy.
-- They are now seeded onto each account as ordinary, editable rules.
--
-- `triggersSeededAt` separates "never seeded" from "the principal deleted
-- every rule" — without it, emptying your rules would resurrect the
-- defaults on the next read.
ALTER TABLE "Account"
    ADD COLUMN IF NOT EXISTS "triggersSeededAt" TIMESTAMP(3);

-- Backfill every existing account with the same constant set the runtime
-- layer was supplying, so no book loses protection at the cut-over.
-- Values mirror lib/agent/triggers/defaults.ts; ids are fresh uuids
-- because these are now real stored rows.
UPDATE "Account"
SET
    "triggersSeededAt" = NOW(),
    "triggers" = jsonb_build_array(
        jsonb_build_object(
            'id', gen_random_uuid()::text,
            'predicate', jsonb_build_object('kind', 'PRICE_MOVE_PCT', 'pct', 7, 'direction', 'UP', 'window', '1D'),
            'action', 'ADD',
            'rationale', 'Up 7% in a day — strength on a held name. Evaluate pressing the winner (add + raise target/stop) if the move is thesis-confirming, not an exhaustion spike. Approval-gated.',
            'cooldownDays', 3,
            'fireMode', 'TACTICAL',
            'source', 'DEFAULT'
        ),
        jsonb_build_object(
            'id', gen_random_uuid()::text,
            'predicate', jsonb_build_object('kind', 'PRICE_MOVE_PCT', 'pct', 7, 'direction', 'DOWN', 'window', '1D'),
            'action', 'ADD',
            'rationale', 'Down 7% in a day — evaluate a pullback-add ONLY if the drop is market/sector-wide with the thesis intact. A company-specific drop is thesis damage: do not add — hold, trim, or exit. Approval-gated.',
            'cooldownDays', 3,
            'fireMode', 'TACTICAL',
            'source', 'DEFAULT'
        ),
        jsonb_build_object(
            'id', gen_random_uuid()::text,
            'predicate', jsonb_build_object('kind', 'GAIN_FROM_ENTRY', 'pct', 10, 'direction', 'UP'),
            'action', 'REVIEW',
            'rationale', 'Up 10% from entry — gain milestone checkpoint. Re-underwrite at the new price: raise the floor to lock the gain in, and arm the next milestone.',
            'cooldownDays', 7,
            'fireMode', 'TACTICAL',
            'source', 'DEFAULT'
        ),
        jsonb_build_object(
            'id', gen_random_uuid()::text,
            'predicate', jsonb_build_object('kind', 'TRAILING_FROM_HIGH', 'pct', 8),
            'action', 'EXIT',
            'rationale', 'Gave back 8% from the high — mechanical gain ratchet. Bank the gain instead of round-tripping it (the IONS lesson: +17% became a loss because no level was ever re-earned).',
            'cooldownDays', 0,
            'fireMode', 'TACTICAL',
            'source', 'DEFAULT'
        ),
        jsonb_build_object(
            'id', gen_random_uuid()::text,
            'predicate', jsonb_build_object('kind', 'GAIN_FROM_ENTRY', 'pct', 12, 'direction', 'DOWN'),
            'action', 'REVIEW',
            'rationale', 'Down 12% from entry — loser attention. Decide hold-vs-cut deliberately, before the hard stop decides for us.',
            'cooldownDays', 7,
            'fireMode', 'TACTICAL',
            'source', 'DEFAULT'
        )
    )
WHERE "triggersSeededAt" IS NULL
  AND ("triggers" IS NULL OR "triggers" = '[]'::jsonb);

-- An account that somehow already had rules keeps them; just mark it
-- seeded so the fallback doesn't fire.
UPDATE "Account" SET "triggersSeededAt" = NOW() WHERE "triggersSeededAt" IS NULL;
