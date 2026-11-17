-- A trigger fires when it becomes true, and once fired it fires again only
-- after a market close finds its condition false (`falseAtCloseAt`, stamped by
-- the 16:20 ET pass; lib/agent/triggers/evaluate.ts). There are no waits.
-- On every stored trigger:
--   • the wait (`cooldownDays`), the written price (`writtenPrice` /
--     `writtenAt`) and the buy re-arm (`rearmedAt`) are stripped, and the
--     re-arm from Thesis.triggerState (an entry left empty goes);
--   • an "or" trigger ({ match: "any" }) becomes one trigger per condition,
--     each with the same action, fire mode, source, playbook mark, note and
--     fire history, and a new id (md5 of the old id and its place). An
--     analyst or account rule's per-stock history (triggerState) is copied
--     to each new id, so a filing it fired on is not fired on again.
-- The starting state needs no write: a trigger that fired before keeps its
-- `lastFiredAt` and has no `falseAtCloseAt`, so it is treated as fired until
-- the first close pass after the deploy finds it false. One that never fired
-- fires at the first check it is true.
-- Applied to Thesis.triggers, AgentConfig.triggers, Account.triggers,
-- Position.buyTriggers and Account.playbooks.
--
-- Dry run against production, 2026-11-17: see the PR.

-- A predicate's "or" parts, flattened; a predicate that is not an "or" is its own one part.
CREATE OR REPLACE FUNCTION "_fs_or_parts"(w jsonb) RETURNS SETOF jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF w->>'match' = 'any' AND jsonb_typeof(w->'conditions') = 'array' THEN
    RETURN QUERY SELECT p FROM jsonb_array_elements(w->'conditions') c, LATERAL "_fs_or_parts"(c) p;
  ELSE
    RETURN NEXT w;
  END IF;
END $$;

-- A whole stored list: each trigger stripped, each "or" split in place.
CREATE OR REPLACE FUNCTION "_fs_list"(list jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(out ORDER BY e.ord, part.ord), '[]'::jsonb)
  FROM jsonb_array_elements(list) WITH ORDINALITY AS e(t, ord),
  LATERAL (SELECT CASE WHEN jsonb_typeof(e.t) = 'object' THEN e.t - 'cooldownDays' - 'writtenPrice' - 'writtenAt' - 'rearmedAt' ELSE e.t END AS fixed) f,
  LATERAL (
    SELECT p, o AS ord FROM "_fs_or_parts"(f.fixed->'predicate') WITH ORDINALITY AS x(p, o)
    WHERE f.fixed->'predicate'->>'match' = 'any'
    UNION ALL
    SELECT NULL, 1 WHERE f.fixed->'predicate'->>'match' IS DISTINCT FROM 'any'
  ) part,
  LATERAL (
    SELECT CASE
      WHEN part.p IS NULL THEN f.fixed
      WHEN f.fixed ? 'id' THEN jsonb_set(jsonb_set(f.fixed, '{predicate}', part.p), '{id}', to_jsonb(md5((f.fixed->>'id') || ':' || part.ord)::uuid::text))
      ELSE jsonb_set(f.fixed, '{predicate}', part.p)
    END AS out
  ) o
$$;

-- The analyst and account rules that split, and how many parts each became: their per-stock history follows.
CREATE TEMP TABLE "_fs_split_rules" AS
SELECT e->>'id' AS id, (SELECT count(*) FROM "_fs_or_parts"(e->'predicate')) AS parts
FROM (
  SELECT jsonb_array_elements(triggers) e FROM "AgentConfig" WHERE jsonb_typeof(triggers) = 'array'
  UNION ALL
  SELECT jsonb_array_elements(triggers) FROM "Account" WHERE jsonb_typeof(triggers) = 'array'
) rules
WHERE e->'predicate'->>'match' = 'any' AND e ? 'id';

UPDATE "Thesis" SET triggers = "_fs_list"(triggers)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

UPDATE "AgentConfig" SET triggers = "_fs_list"(triggers)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

UPDATE "Account" SET triggers = "_fs_list"(triggers)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

UPDATE "Position" SET "buyTriggers" = "_fs_list"("buyTriggers")
WHERE jsonb_typeof("buyTriggers") = 'array' AND jsonb_array_length("buyTriggers") > 0;

UPDATE "Account" SET playbooks = (
  SELECT COALESCE(jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'array' THEN "_fs_list"(v) ELSE v END), '{}'::jsonb)
  FROM jsonb_each(playbooks) AS x(k, v)
)
WHERE jsonb_typeof(playbooks) = 'object' AND playbooks <> '{}'::jsonb;

-- Per-stock fire history: re-arm stamps stripped (an entry left empty goes), a split rule's copied to each part.
UPDATE "Thesis" SET "triggerState" = (
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM (
    SELECT x.k, CASE WHEN jsonb_typeof(x.v) = 'object' THEN x.v - 'rearmedAt' ELSE x.v END AS v
    FROM jsonb_each("triggerState") AS x(k, v)
    UNION ALL
    SELECT md5(x.k || ':' || n)::uuid::text, CASE WHEN jsonb_typeof(x.v) = 'object' THEN x.v - 'rearmedAt' ELSE x.v END
    FROM jsonb_each("triggerState") AS x(k, v)
    JOIN "_fs_split_rules" s ON s.id = x.k, generate_series(1, s.parts) n
  ) kept
  WHERE NOT (jsonb_typeof(v) = 'object' AND v = '{}'::jsonb)
)
WHERE jsonb_typeof("triggerState") = 'object' AND "triggerState" <> '{}'::jsonb
  AND EXISTS (
    SELECT 1 FROM jsonb_each("triggerState") AS x(k, v)
    WHERE (jsonb_typeof(x.v) = 'object' AND x.v ? 'rearmedAt') OR x.k IN (SELECT id FROM "_fs_split_rules")
  );

DROP TABLE "_fs_split_rules";
DROP FUNCTION "_fs_list"(jsonb);
DROP FUNCTION "_fs_or_parts"(jsonb);
