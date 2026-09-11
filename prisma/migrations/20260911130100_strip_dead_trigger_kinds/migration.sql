-- DAV-247: strip the trigger kinds that could never fire from every stored
-- ladder. SIGNAL_TYPE / GUIDANCE_CHANGE / FILING needed the signal router,
-- which has been off since 2026-05-31; TIME_ELAPSED is a remnant. The kinds
-- left the type, the schema and the evaluator in the same PR.
--
-- A dead condition is "never true", and the sweep keeps that meaning exactly:
--   • a dead leaf                → removed
--   • an AND containing one      → never true → the whole rung is removed
--   • an OR                      → its dead branches removed; if one branch
--                                  is left, the OR is unwrapped to it; if none,
--                                  the rung is removed
-- So no surviving rung becomes easier to fire than it was.
--
-- Dry run against production 2026-09-11: 1,062 thesis rungs; 207 removed,
-- 1 rewritten (IREN: OR[earnings miss ≥15%, guidance cut] → earnings miss
-- ≥15%), 119 theses touched, 0 dead kinds left. Account and analyst ladders
-- carried none.

CREATE OR REPLACE FUNCTION "_dav247_strip_dead"(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; c jsonb; r jsonb; out_kids jsonb := '[]'::jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN p; END IF;
  k := p->>'kind';
  IF k IN ('SIGNAL_TYPE', 'GUIDANCE_CHANGE', 'FILING', 'TIME_ELAPSED') THEN RETURN NULL; END IF;
  IF k IN ('AND', 'OR') THEN
    IF jsonb_typeof(p->'predicates') <> 'array' THEN RETURN p; END IF;
    FOR c IN SELECT value FROM jsonb_array_elements(p->'predicates') LOOP
      r := "_dav247_strip_dead"(c);
      IF r IS NULL THEN
        IF k = 'AND' THEN RETURN NULL; END IF;
      ELSE
        out_kids := out_kids || jsonb_build_array(r);
      END IF;
    END LOOP;
    IF jsonb_array_length(out_kids) = 0 THEN RETURN NULL; END IF;
    IF jsonb_array_length(out_kids) = 1 THEN RETURN out_kids->0; END IF;
    RETURN jsonb_set(p, '{predicates}', out_kids);
  END IF;
  RETURN p;
END $$;

UPDATE "Thesis" t
SET triggers = (
  SELECT COALESCE(
    jsonb_agg(jsonb_set(e.r, '{predicate}', "_dav247_strip_dead"(e.r->'predicate')) ORDER BY e.ord),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(t.triggers) WITH ORDINALITY AS e(r, ord)
  WHERE "_dav247_strip_dead"(e.r->'predicate') IS NOT NULL
)
WHERE jsonb_typeof(t.triggers) = 'array'
  AND t.triggers::text ~ '"kind": ?"(SIGNAL_TYPE|GUIDANCE_CHANGE|FILING|TIME_ELAPSED)"';

UPDATE "AgentConfig" a
SET triggers = (
  SELECT COALESCE(
    jsonb_agg(jsonb_set(e.r, '{predicate}', "_dav247_strip_dead"(e.r->'predicate')) ORDER BY e.ord),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(a.triggers) WITH ORDINALITY AS e(r, ord)
  WHERE "_dav247_strip_dead"(e.r->'predicate') IS NOT NULL
)
WHERE jsonb_typeof(a.triggers) = 'array'
  AND a.triggers::text ~ '"kind": ?"(SIGNAL_TYPE|GUIDANCE_CHANGE|FILING|TIME_ELAPSED)"';

UPDATE "Account" a
SET triggers = (
  SELECT COALESCE(
    jsonb_agg(jsonb_set(e.r, '{predicate}', "_dav247_strip_dead"(e.r->'predicate')) ORDER BY e.ord),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(a.triggers) WITH ORDINALITY AS e(r, ord)
  WHERE "_dav247_strip_dead"(e.r->'predicate') IS NOT NULL
)
WHERE jsonb_typeof(a.triggers) = 'array'
  AND a.triggers::text ~ '"kind": ?"(SIGNAL_TYPE|GUIDANCE_CHANGE|FILING|TIME_ELAPSED)"';

DROP FUNCTION "_dav247_strip_dead"(jsonb);
