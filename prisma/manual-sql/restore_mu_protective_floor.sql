-- restore_mu_protective_floor.sql — undo the 2026-08-18 MU ratchet violation.
--
-- STATUS: not yet run. Operator-run, ONLY after the principal confirms the
-- level. The principal decides the number — $948 below is where the floor
-- stood before the violation, not a recommendation.
--
-- Context (run review 2026-08-18, DAV-185): at 8:02 AM the PEAD Specialist
-- raised MU's sell-if-below floor 860 → 948 (firing automatically / DIRECT).
-- At 10:55 the same analyst lowered it to 814 — below avgCost $895.94 — and
-- demoted it to judgment-first (TACTICAL), while two MU sell proposals from
-- the 948 breach sat awaiting approval. The code gate shipped with DAV-185
-- prevents a repeat; this script repairs the row it already damaged.
--
-- Verified against the live row 2026-08-19: thesis cmrp6chyu000h04l5roqq5ha1
-- (MU, HOLDING, PEAD Specialist), rung id 't4' =
--   { action: EXIT, fireMode: TACTICAL, predicate: PRICE_BELOW 814 }.
-- The 8% trailing rung (t16, DIRECT) survived the edit and still stands.
-- The stopLoss COLUMN sits at 814 via a legal raise (730 → 814); left alone.
--
-- ⚠️  PREFERRED PATH: the thesis sheet UI. The principal can edit the trigger
-- inline (thesis sheet → triggers section) — that writes through the
-- principal-authored path with a proper audit row. Use this SQL only if the
-- UI path is inconvenient. If you want the restored level to differ from
-- 948, change BOTH the level below and this header.

UPDATE "Thesis"
SET triggers = (
  SELECT jsonb_agg(
    CASE
      WHEN elem->>'id' = 't4' THEN
        elem
        || jsonb_build_object(
             'predicate', jsonb_build_object('kind', 'PRICE_BELOW', 'level', 948),
             'fireMode', 'DIRECT',
             -- The restore is the principal's act; label the value accordingly.
             'source', 'PRINCIPAL'
           )
      ELSE elem
    END
  )
  FROM jsonb_array_elements(triggers) AS elem
)
WHERE id = 'cmrp6chyu000h04l5roqq5ha1'
  AND ticker = 'MU'
  AND status = 'HOLDING';

-- Sanity check afterwards (expect level 948, fireMode DIRECT on t4):
-- SELECT elem FROM "Thesis", jsonb_array_elements(triggers) elem
-- WHERE id = 'cmrp6chyu000h04l5roqq5ha1' AND elem->>'id' = 't4';
