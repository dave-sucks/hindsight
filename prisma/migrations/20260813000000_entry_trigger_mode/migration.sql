-- Analyst entry style — see docs/plans/ENTRY_TRIGGER_SEMANTICS.md.
--
-- The ENTER rung on a WATCHING thesis was hardcoded to PRICE_ABOVE
-- (breakout). For a dip-buying analyst that is backwards: it alerts only
-- once the name costs MORE than the analyst said it would pay, and can
-- never fire while the name is cheap. Secular Compounder had eight names
-- trading below their own stated buy price with no reachable ENTER path.
--
-- BREAKOUT is the default so no existing seat changes behavior without an
-- explicit opt-in.
ALTER TABLE "AgentConfig"
    ADD COLUMN IF NOT EXISTS "entryTriggerMode" TEXT NOT NULL DEFAULT 'BREAKOUT';
