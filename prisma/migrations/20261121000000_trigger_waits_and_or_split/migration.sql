-- A trigger fires when it is true, and the wait saved on it (cooldownDays) is
-- the only thing that stops a repeat. Three things the check used to do at
-- read time are gone (lib/agent/triggers/evaluate.ts), so each stored trigger
-- is saved with what they made it do, and nothing fires differently after
-- the deploy than the floors made it fire before:
--   • the wait in force is written on it: a 0 or a missing wait reads as its
--     measure's default, a review on a state (an average, near the 52-week
--     high, strength vs the S&P) at least 7 days, a trade at least 1 day;
--   • the written price (writtenPrice / writtenAt) and the buy re-arm
--     (Thesis.triggerState[id].rearmedAt) are stripped;
--   • an "or" trigger ({ match: "any" }) becomes one trigger per condition,
--     each with the same action, fire mode, source, playbook mark, note, wait
--     and fire history, and a new id (md5 of the old id and its place). An
--     analyst or account rule's per-stock fire history (triggerState) is
--     copied to each new id, so a filing it fired on is not fired on again.
-- Applied to Thesis.triggers, AgentConfig.triggers, Account.triggers,
-- Position.buyTriggers and Account.playbooks (a template's wait is touched
-- only when it names one). A stored condition that is not the condition shape
-- (a kind removed in August) is left as it is: nothing checks it.
--
-- Dry run against production, 2026-11-17: see the PR.

CREATE OR REPLACE FUNCTION "_tw_is_shape"(w jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(w) <> 'object' THEN RETURN false; END IF;
  IF jsonb_typeof(w->'watch') = 'string' THEN
    RETURN w->>'watch' IN ('price','move','volume','rsi','strength','gap','report','surprise','filing','insiders','repeat','from_date');
  END IF;
  IF w->>'match' NOT IN ('all','any') OR jsonb_typeof(w->'conditions') <> 'array' OR jsonb_array_length(w->'conditions') = 0 THEN RETURN false; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(w->'conditions') c WHERE NOT "_tw_is_shape"(c));
END $$;

-- The measure's default wait (lib/agent/triggers/condition/measures, as of this migration).
CREATE OR REPLACE FUNCTION "_tw_default"(w jsonb, action text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  days numeric[];
  one_measure boolean;
BEGIN
  IF jsonb_typeof(w->'watch') = 'string' THEN
    RETURN CASE w->>'watch'
      WHEN 'price' THEN CASE WHEN w->>'variable' IN ('sma20','sma50','sma150','sma200','street_avg','street_high','street_low') AND action = 'REVIEW' THEN 7 ELSE 1 END
      WHEN 'move' THEN CASE
        WHEN w->>'variable' = 'entry' THEN CASE WHEN action = 'EXIT' THEN 1 ELSE 7 END
        WHEN w->>'is' = 'near' AND w->>'variable' = 'high52' AND action = 'REVIEW' THEN 7
        ELSE 1 END
      WHEN 'strength' THEN 7
      WHEN 'report' THEN 30
      WHEN 'surprise' THEN 7
      WHEN 'insiders' THEN 30
      WHEN 'filing' THEN 0
      WHEN 'repeat' THEN CASE WHEN jsonb_typeof(w->'value') = 'number' THEN (w->>'value')::numeric ELSE 0 END
      WHEN 'from_date' THEN CASE WHEN jsonb_typeof(w->'value') = 'number' THEN (w->>'value')::numeric ELSE 0 END
      ELSE 1 END;
  END IF;
  SELECT array_agg("_tw_default"(c, action)) INTO days FROM jsonb_array_elements(w->'conditions') c;
  SELECT count(DISTINCT COALESCE(c->>'watch', '')) = 1 AND bool_and(jsonb_typeof(c->'watch') = 'string')
    INTO one_measure FROM jsonb_array_elements(w->'conditions') c;
  RETURN CASE WHEN one_measure THEN (SELECT max(d) FROM unnest(days) d) ELSE greatest(1, (SELECT max(d) FROM unnest(days) d)) END;
END $$;

-- Somewhere a stock sits for weeks: an average or a Street target, near the 52-week high, strength vs the S&P.
CREATE OR REPLACE FUNCTION "_tw_is_state"(w jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(w->'watch') = 'string' THEN
    RETURN (w->>'watch' = 'price' AND w->>'variable' IN ('sma20','sma50','sma150','sma200','street_avg','street_high','street_low'))
        OR (w->>'watch' = 'move' AND w->>'is' = 'near' AND w->>'variable' = 'high52')
        OR w->>'watch' = 'strength';
  END IF;
  RETURN jsonb_array_length(w->'conditions') > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(w->'conditions') c WHERE NOT "_tw_is_state"(c));
END $$;

-- One stored trigger: the wait in force written on it, the written price and re-arm stripped.
CREATE OR REPLACE FUNCTION "_tw_trigger"(t jsonb, template boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  r jsonb := t - 'writtenPrice' - 'writtenAt' - 'rearmedAt';
  action text := t->>'action';
  saved numeric;
  wait numeric;
BEGIN
  IF jsonb_typeof(t) <> 'object' OR NOT "_tw_is_shape"(t->'predicate') THEN RETURN t; END IF;
  IF template AND jsonb_typeof(t->'cooldownDays') <> 'number' THEN RETURN r; END IF;
  saved := CASE WHEN jsonb_typeof(t->'cooldownDays') = 'number' THEN (t->>'cooldownDays')::numeric END;
  wait := CASE WHEN saved IS NULL OR saved = 0 THEN "_tw_default"(t->'predicate', action) ELSE saved END;
  IF action = 'REVIEW' AND "_tw_is_state"(t->'predicate') THEN wait := greatest(wait, 7);
  ELSIF action IS DISTINCT FROM 'REVIEW' THEN wait := greatest(wait, 1);
  END IF;
  RETURN jsonb_set(r, '{cooldownDays}', to_jsonb(wait));
END $$;

-- A predicate's "or" parts, flattened; a predicate that is not an "or" is its own one part.
CREATE OR REPLACE FUNCTION "_tw_or_parts"(w jsonb) RETURNS SETOF jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF w->>'match' = 'any' AND jsonb_typeof(w->'conditions') = 'array' THEN
    RETURN QUERY SELECT p FROM jsonb_array_elements(w->'conditions') c, LATERAL "_tw_or_parts"(c) p;
  ELSE
    RETURN NEXT w;
  END IF;
END $$;

-- A whole stored list: each trigger saved with its wait, each "or" split in place.
CREATE OR REPLACE FUNCTION "_tw_list"(list jsonb, template boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(out ORDER BY e.ord, part.ord), '[]'::jsonb)
  FROM jsonb_array_elements(list) WITH ORDINALITY AS e(t, ord),
  LATERAL (SELECT "_tw_trigger"(e.t, template) AS fixed) f,
  LATERAL (
    SELECT p, o AS ord FROM "_tw_or_parts"(f.fixed->'predicate') WITH ORDINALITY AS x(p, o)
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
CREATE TEMP TABLE "_tw_split_rules" AS
SELECT e->>'id' AS id, (SELECT count(*) FROM "_tw_or_parts"(e->'predicate')) AS parts
FROM (
  SELECT jsonb_array_elements(triggers) e FROM "AgentConfig" WHERE jsonb_typeof(triggers) = 'array'
  UNION ALL
  SELECT jsonb_array_elements(triggers) FROM "Account" WHERE jsonb_typeof(triggers) = 'array'
) rules
WHERE e->'predicate'->>'match' = 'any' AND e ? 'id';

UPDATE "Thesis" SET triggers = "_tw_list"(triggers, false)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

UPDATE "AgentConfig" SET triggers = "_tw_list"(triggers, false)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

UPDATE "Account" SET triggers = "_tw_list"(triggers, false)
WHERE jsonb_typeof(triggers) = 'array' AND jsonb_array_length(triggers) > 0;

UPDATE "Position" SET "buyTriggers" = "_tw_list"("buyTriggers", false)
WHERE jsonb_typeof("buyTriggers") = 'array' AND jsonb_array_length("buyTriggers") > 0;

UPDATE "Account" SET playbooks = (
  SELECT COALESCE(jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'array' THEN "_tw_list"(v, true) ELSE v END), '{}'::jsonb)
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
    JOIN "_tw_split_rules" s ON s.id = x.k, generate_series(1, s.parts) n
  ) kept
  WHERE NOT (jsonb_typeof(v) = 'object' AND v = '{}'::jsonb)
)
WHERE jsonb_typeof("triggerState") = 'object' AND "triggerState" <> '{}'::jsonb
  AND EXISTS (
    SELECT 1 FROM jsonb_each("triggerState") AS x(k, v)
    WHERE (jsonb_typeof(x.v) = 'object' AND x.v ? 'rearmedAt') OR x.k IN (SELECT id FROM "_tw_split_rules")
  );

DROP TABLE "_tw_split_rules";
DROP FUNCTION "_tw_list"(jsonb, boolean);
DROP FUNCTION "_tw_or_parts"(jsonb);
DROP FUNCTION "_tw_trigger"(jsonb, boolean);
DROP FUNCTION "_tw_is_state"(jsonb);
DROP FUNCTION "_tw_default"(jsonb, text);
DROP FUNCTION "_tw_is_shape"(jsonb);
