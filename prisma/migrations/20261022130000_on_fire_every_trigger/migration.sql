-- On fire: the same three choices on every trigger (DO_IT, ASK_NOW, NEXT_MORNING).
-- Every stored trigger is written with the mode it already behaved as, so no
-- trigger changes what it does and nothing reads an unset or old value:
--   • a REVIEW, whatever it stored        → NEXT_MORNING (reviews waited for the morning run)
--   • a DIRECT sale the old gate allowed  → DO_IT (a typed price, or a % from a
--     recent close, our entry or the high; every stored DIRECT is one of these)
--   • everything else (TACTICAL or unset) → ASK_NOW (a trigger run started)
-- A red filing on a stock we hold still starts a run the same day; that rule is
-- the evaluator's, not the trigger's.
--
-- Dry run against production 2026-10-22, every row of Thesis, AgentConfig and
-- Account: 831 triggers; 567 NEXT_MORNING, 255 ASK_NOW, 9 DO_IT. Live (held or
-- watched stocks, analyst and account rules): 142; 114 NEXT_MORNING, 27 ASK_NOW,
-- 1 DO_IT. The counts by level and action are in the PR.

CREATE OR REPLACE FUNCTION "_on_fire"(r jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN r->>'action' = 'REVIEW' THEN 'NEXT_MORNING'
    WHEN r->>'action' = 'EXIT' AND r->>'fireMode' = 'DIRECT'
     AND ((r->'predicate'->>'watch' = 'price' AND COALESCE(r->'predicate'->>'variable', '') = '')
       OR (r->'predicate'->>'watch' = 'move' AND r->'predicate'->>'variable' IN ('prev_close', 'close_5d', 'close_20d', 'entry', 'peak')))
      THEN 'DO_IT'
    ELSE 'ASK_NOW'
  END
$$;

CREATE OR REPLACE FUNCTION "_on_fire_list"(list jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    jsonb_agg(
      CASE WHEN jsonb_typeof(e.r) = 'object' THEN jsonb_set(e.r, '{fireMode}', to_jsonb("_on_fire"(e.r))) ELSE e.r END
      ORDER BY e.ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(list) WITH ORDINALITY AS e(r, ord)
$$;

UPDATE "Thesis" SET triggers = "_on_fire_list"(triggers)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

UPDATE "AgentConfig" SET triggers = "_on_fire_list"(triggers)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

UPDATE "Account" SET triggers = "_on_fire_list"(triggers)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

DROP FUNCTION "_on_fire_list"(jsonb);
DROP FUNCTION "_on_fire"(jsonb);
