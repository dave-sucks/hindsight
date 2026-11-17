-- "Stop watching if" is its own stored action (STOP_WATCHING), on a stock we
-- only watch, and "Sell if" (EXIT) is only on a holding. Until now a watch's
-- line was stored as a sale (EXIT, once as DEMOTE), and the check read it as
-- "stop watching", on the close, because the stock wasn't held. Each line on a
-- stock we don't hold is now stored as what it did, so nothing fires
-- differently:
--   • action STOP_WATCHING, with its one fire mode (ASK_NOW; it stops watching)
--   • a typed price reads the close (settings.close true), as the check read it
-- A copy of an earlier line (AAPL: the DEMOTE and the EXIT, both below
-- $325.33) is dropped: the ladder only ever read the first.
--
-- Dry run against a copy of production, 2026-11-16: 9 lines on 8 watched
-- stocks (AAPL, EXEL, GD, HTFL, ISRG, MSFT, TRV, WST; AAPL's DEMOTE); AAPL ends
-- with one. No holding, analyst or account rule changes.

-- Why a buy's sell price is there, in the analyst's words (place_trade's sell_reason).
ALTER TABLE "Position" ADD COLUMN IF NOT EXISTS "stopReason" TEXT;

CREATE OR REPLACE FUNCTION "_stop_watching"(r jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(r) = 'object' AND r->>'action' IN ('EXIT', 'DEMOTE') THEN
      jsonb_set(
        r || '{"action": "STOP_WATCHING", "fireMode": "ASK_NOW"}'::jsonb,
        '{predicate}',
        CASE
          WHEN r->'predicate'->>'watch' = 'price'
           AND jsonb_typeof(r->'predicate'->'value') = 'number'
           AND r->'predicate'->>'variable' IS NULL
            THEN r->'predicate' || jsonb_build_object('settings', COALESCE(r->'predicate'->'settings', '{}'::jsonb) || '{"close": true}'::jsonb)
          ELSE r->'predicate'
        END
      )
    ELSE r
  END
$$;

CREATE OR REPLACE FUNCTION "_stop_watching_list"(list jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  WITH converted AS (
    SELECT "_stop_watching"(e.r) AS r, e.ord
    FROM jsonb_array_elements(list) WITH ORDINALITY AS e(r, ord)
  ),
  numbered AS (
    SELECT r, ord,
      CASE WHEN r->>'action' = 'STOP_WATCHING' THEN
        row_number() OVER (PARTITION BY r->>'action', r->'predicate'->>'watch', r->'predicate'->>'is', r->'predicate'->>'variable', r->'predicate'->>'value' ORDER BY ord)
      END AS copy
    FROM converted
  )
  SELECT COALESCE(jsonb_agg(r ORDER BY ord) FILTER (WHERE copy IS NULL OR copy = 1), '[]'::jsonb)
  FROM numbered
$$;

UPDATE "Thesis" SET triggers = "_stop_watching_list"(triggers)
WHERE status IN ('WATCHING', 'PROMOTED')
  AND jsonb_typeof(triggers) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(triggers) e WHERE e->>'action' IN ('EXIT', 'DEMOTE'));

DROP FUNCTION "_stop_watching_list"(jsonb);
DROP FUNCTION "_stop_watching"(jsonb);
