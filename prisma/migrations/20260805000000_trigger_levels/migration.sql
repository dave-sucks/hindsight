-- The trigger cascade: account → analyst → thesis, most-specific wins.
--
-- Adds the two levels above the thesis, plus per-thesis fire bookkeeping
-- for the rungs a thesis inherits rather than stores.
--
-- All three columns are additive with safe defaults, so this migration is
-- a no-op for behavior on its own: an empty account/analyst array means
-- "inherit whatever is beneath you", which is exactly today's state. The
-- resolver (lib/agent/triggers/levels) is what gives them effect.
--
-- Existing theses keep every rung currently materialized on them. Those
-- read as THESIS-level and stay editable, so nothing regresses; deleting
-- one reveals the inherited rung underneath it. See
-- docs/plans/TRIGGER_MODEL.md §5.5.

-- ACCOUNT level — standing rules for every analyst on the account.
-- Same Trigger[] shape as "Thesis"."triggers" (lib/agent/triggers/types),
-- validated by the same Zod schema.
ALTER TABLE "Account"
    ADD COLUMN IF NOT EXISTS "triggers" JSONB NOT NULL DEFAULT '[]';

-- ANALYST level — per-analyst overrides of the account rules
-- ("Momentum trails 5%, the Compounder trails 12%").
ALTER TABLE "AgentConfig"
    ADD COLUMN IF NOT EXISTS "triggers" JSONB NOT NULL DEFAULT '[]';

-- Per-thesis fire state for INHERITED rungs: { [triggerId]: ISO-8601 }.
--
-- An analyst rung is one row shared by every thesis under that analyst,
-- so its lastFiredAt cannot live on the rung itself — one thesis firing
-- would put every sibling thesis into cooldown on a trigger that never
-- fired for them. Thesis-level rungs keep lastFiredAt inline as before.
ALTER TABLE "Thesis"
    ADD COLUMN IF NOT EXISTS "triggerState" JSONB NOT NULL DEFAULT '{}';
