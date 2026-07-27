-- Backfill trigger ids (2026-06-02) — one-off data heal.
--
-- Root cause: lib/agent/triggers/schema.ts declared the trigger `id` field
-- `.optional()` with a description promising "auto-generated if omitted"
-- that was never implemented. Agent-supplied trigger arrays (record_thesis /
-- update_thesis / thesis-writer) therefore persisted WITHOUT ids. The
-- trigger-evaluator's parseTriggers silently dropped id-less triggers, so
-- 25 of 30 active theses — including the live MRVL/TSM stop-loss EXIT
-- triggers — never fired a tactical run. The ENTER trigger on the LITE
-- thesis (price already well above its entry) never fired either.
--
-- The code fix (schema `.default(() => randomUUID())` + parseTriggers
-- self-heal) prevents recurrence. This script heals existing rows.
--
-- Idempotent: only rewrites rows that have at least one id-less trigger,
-- and only injects an id into the elements missing one. Safe to re-run.
-- Already applied to production 2026-06-02; included here for
-- reproducibility on any other environment.

UPDATE "Thesis"
SET triggers = (
  SELECT jsonb_agg(
    CASE WHEN (elem->>'id') IS NOT NULL THEN elem
         ELSE elem || jsonb_build_object('id', gen_random_uuid()::text) END
  )
  FROM jsonb_array_elements(triggers::jsonb) elem
)
WHERE status IN ('ACTIVE','WATCHING')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(triggers::jsonb) e WHERE (e->>'id') IS NULL
  );
