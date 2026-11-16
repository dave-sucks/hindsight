-- PROPOSED, NOT RUN. Restore the plan levels a trigger run's empty field removed.
-- Run by hand only after the owner approves:
--   psql $DIRECT_URL -f prisma/manual-sql/restore_levels_removed_by_empty_fields_2026_11_16.sql
--
-- Context: until the fix that ships with this file, update_thesis read a level
-- sent empty (entry_price / target_price / stop_loss: null) as "remove that
-- trigger". The trigger run's model fills every field it is offered, so a
-- level it kept came back null. In the 30 days to 2026-11-16, 16 saves removed
-- 17 triggers that way (RunMessage threads, every update_thesis call with a
-- null level whose trigger_ops show a removal the call did not name by id).
-- Since then the rule is: an empty level is no change; a level is removed by
-- id in remove_trigger_ids.
--
-- Restored here: the six stocks that still hold or watch with that slot empty
-- (PRAX's buy, floor and target; the target of CEG, GEV, MU, NVDA and PLTR).
-- Each trigger goes back with its own id and the wording it had when removed
-- (read from the analysts' get_theses results and the calls that set it), so
-- its Activity history and cooldown stay with it. A review's fire mode is
-- Flag for Review and a buy's or floor's Send to Agent, as each was (the reads
-- printed no other mode). No written price is stamped: every level sits on the
-- side of today's price that does not fire.
--
-- Not restored, and why:
--   IOT  target, 10-19 and 11-06: IOT has a target again (added after).
--   WST  target, 10-30 and 11-04: WST has a target again (added after).
--   ASML target, 10-22: sold since; on watch with no triggers.
--   MSFT target, 11-11: sold since; re-planned as a watch with a new buy.
--   NVDA 10-20, CEG 10-21, GEV 10-26: the same targets set again later; the
--   later ones are restored below.
--
-- Guarded and idempotent: each statement applies only while the stock is in
-- the status it had, the slot's column is still empty and the trigger id is
-- not on the list. Each applied restore writes one Activity line (a title, no
-- paragraph). Read the SELECT at the end, then COMMIT; anything else, ROLLBACK.

BEGIN;

-- PRAX (WATCHING): Buy if above $351.75 · only on the close, Take the plan down if below $236, Review if above $392. removed by cmwjd2222000c07jqrbamz5xs (floor, target) and cmwjd2cyp000q07jqewqgkh35 (buy), 2026-11-16 09:30 ET; both notes kept the plan.
WITH restored AS (
  UPDATE "Thesis"
  SET triggers = triggers || $j$[{"id": "fd8ac088-1fba-4b7f-b792-c24727b2a7a9", "action": "ENTER", "source": "AGENT", "fireMode": "ASK_NOW", "predicate": {"watch": "price", "is": "above", "value": 351.75, "settings": {"close": true}}, "rationale": "A close above the 20-session high of $351.64 confirms the pre-PDUFA run-up has started — that is the signal I need before entering. Send to me; I want to confirm nothing changed on the regulatory front before buying.", "cooldownDays": 1}, {"id": "525fe4a5-37a2-46fe-83cd-269ba2e78ea3", "action": "EXIT", "source": "DEFAULT", "fireMode": "ASK_NOW", "predicate": {"watch": "price", "is": "below", "value": 236}, "rationale": "A close below $236 would mean the market has decided the regulatory path is broken — if relutrigine's review produces a refuse-to-file or a clinical hold, that is what this level reflects. The structure under it is the October 14 swing low of $236.79; the stop sits just under that level, which is 1.3× ATR(14) of $18.25 below the swing low. Because this is a binary event setup, size is the actual risk control — a gap will skip any stop, and the $236 level is structural and advisory, not a hard exit on a gap down.", "cooldownDays": 1}, {"id": "4710e772-f65f-4f81-810a-0ff74b206096", "action": "REVIEW", "source": "DEFAULT", "fireMode": "NEXT_MORNING", "predicate": {"watch": "price", "is": "above", "value": 392}, "rationale": "A review at the August 20 high of $392.70 — the prior peak before the PDUFA extension drove the selloff. If the stock reaches that level before December 10, I'll trim and reassess; the real exit rule is a sale 1–2 weeks before the December 27 decision date regardless of price, to avoid holding through the binary.", "cooldownDays": 1}]$j$::jsonb,
      "entryPrice" = 351.75, "targetPrice" = 392, "stopLoss" = 236,
      "updatedAt" = now()
  WHERE id = 'cmwfbxbuq000008kr9jw3zcv4'
    AND status = 'WATCHING'
    AND "entryPrice" IS NULL AND "targetPrice" IS NULL AND "stopLoss" IS NULL
    AND NOT (triggers @> $j$[{"id": "fd8ac088-1fba-4b7f-b792-c24727b2a7a9"}]$j$::jsonb) AND NOT (triggers @> $j$[{"id": "525fe4a5-37a2-46fe-83cd-269ba2e78ea3"}]$j$::jsonb) AND NOT (triggers @> $j$[{"id": "4710e772-f65f-4f81-810a-0ff74b206096"}]$j$::jsonb)
  RETURNING id
)
INSERT INTO "ThesisUpdate" (id, "thesisId", "timestamp", type, "fieldChanges", summary)
SELECT 'mfix' || md5(random()::text || clock_timestamp()::text), id, now(), 'UPDATED',
       $j${"triggerOps": {"from": null, "to": [{"id": "fd8ac088-1fba-4b7f-b792-c24727b2a7a9", "op": "add", "text": "Added: Buy if above $351.75 · only on the close"}, {"id": "525fe4a5-37a2-46fe-83cd-269ba2e78ea3", "op": "add", "text": "Added: Take the plan down if below $236"}, {"id": "4710e772-f65f-4f81-810a-0ff74b206096", "op": "add", "text": "Added: Review if above $392"}]}, "entryPrice": {"from": null, "to": 351.75}, "targetPrice": {"from": null, "to": 392}, "stopLoss": {"from": null, "to": 236}}$j$::jsonb,
       $j$Restored: Buy if above $351.75 · only on the close; Take the plan down if below $236; Review if above $392 (removed by an empty level in a save that kept it)$j$
FROM restored;

-- CEG (HOLDING): Review if above $360. removed by cmwaserx5000308lbaeewefo0, 2026-11-10 09:30 ET.
WITH restored AS (
  UPDATE "Thesis"
  SET triggers = triggers || $j$[{"id": "c857e10e-0c4c-491f-8a71-5a3c9b081a9e", "action": "REVIEW", "source": "AGENT", "fireMode": "NEXT_MORNING", "predicate": {"watch": "price", "is": "above", "value": 360}, "rationale": "The two-year value case still points to about $360 as the stock prices in the signed long-dated nuclear contracts, the Crane restart, and the 2026–27 cash build; that remains above the Street’s $342 average target.", "cooldownDays": 1}]$j$::jsonb,
      "targetPrice" = 360,
      "updatedAt" = now()
  WHERE id = 'cmqb2ku1a000q04l6jtquuqr6'
    AND status = 'HOLDING'
    AND "targetPrice" IS NULL
    AND NOT (triggers @> $j$[{"id": "c857e10e-0c4c-491f-8a71-5a3c9b081a9e"}]$j$::jsonb)
  RETURNING id
)
INSERT INTO "ThesisUpdate" (id, "thesisId", "timestamp", type, "fieldChanges", summary)
SELECT 'mfix' || md5(random()::text || clock_timestamp()::text), id, now(), 'UPDATED',
       $j${"triggerOps": {"from": null, "to": [{"id": "c857e10e-0c4c-491f-8a71-5a3c9b081a9e", "op": "add", "text": "Added: Review if above $360"}]}, "targetPrice": {"from": null, "to": 360}}$j$::jsonb,
       $j$Restored: Review if above $360 (removed by an empty level in a save that kept it)$j$
FROM restored;

-- GEV (HOLDING): Review if above $1300. removed by cmwases7k000608lb2717s6wb, 2026-11-10 09:30 ET, three seconds after another run reworded it.
WITH restored AS (
  UPDATE "Thesis"
  SET triggers = triggers || $j$[{"id": "8733a7a7-9077-41d4-908b-99c5d70745b4", "action": "REVIEW", "source": "AGENT", "fireMode": "NEXT_MORNING", "predicate": {"watch": "price", "is": "above", "value": 1300}, "rationale": "The long-term value case is still about $1,300 as orders it has not delivered yet turn into power and grid sales and margins improve.", "cooldownDays": 1}]$j$::jsonb,
      "targetPrice" = 1300,
      "updatedAt" = now()
  WHERE id = 'cmqb2nt4b001r04k0ahd3crrx'
    AND status = 'HOLDING'
    AND "targetPrice" IS NULL
    AND NOT (triggers @> $j$[{"id": "8733a7a7-9077-41d4-908b-99c5d70745b4"}]$j$::jsonb)
  RETURNING id
)
INSERT INTO "ThesisUpdate" (id, "thesisId", "timestamp", type, "fieldChanges", summary)
SELECT 'mfix' || md5(random()::text || clock_timestamp()::text), id, now(), 'UPDATED',
       $j${"triggerOps": {"from": null, "to": [{"id": "8733a7a7-9077-41d4-908b-99c5d70745b4", "op": "add", "text": "Added: Review if above $1300"}]}, "targetPrice": {"from": null, "to": 1300}}$j$::jsonb,
       $j$Restored: Review if above $1300 (removed by an empty level in a save that kept it)$j$
FROM restored;

-- MU (HOLDING): Review if above $1500. removed by cmvvbi3fj000208jh4ea9diyl, 2026-10-30 14:41 ET.
WITH restored AS (
  UPDATE "Thesis"
  SET triggers = triggers || $j$[{"id": "bb928325-0cde-4168-a03c-aca52371fc8f", "action": "REVIEW", "source": "AGENT", "fireMode": "NEXT_MORNING", "predicate": {"watch": "price", "is": "above", "value": 1500}, "rationale": "The 1.272 Fibonacci extension of the primary up-leg lands at $1,523, supporting the $1,500 target.", "cooldownDays": 1}]$j$::jsonb,
      "targetPrice" = 1500,
      "updatedAt" = now()
  WHERE id = 'cmv9nm3xo000o06l3om8r7ath'
    AND status = 'HOLDING'
    AND "targetPrice" IS NULL
    AND NOT (triggers @> $j$[{"id": "bb928325-0cde-4168-a03c-aca52371fc8f"}]$j$::jsonb)
  RETURNING id
)
INSERT INTO "ThesisUpdate" (id, "thesisId", "timestamp", type, "fieldChanges", summary)
SELECT 'mfix' || md5(random()::text || clock_timestamp()::text), id, now(), 'UPDATED',
       $j${"triggerOps": {"from": null, "to": [{"id": "bb928325-0cde-4168-a03c-aca52371fc8f", "op": "add", "text": "Added: Review if above $1500"}]}, "targetPrice": {"from": null, "to": 1500}}$j$::jsonb,
       $j$Restored: Review if above $1500 (removed by an empty level in a save that kept it)$j$
FROM restored;

-- NVDA (HOLDING): Review if above $243. set by the 08:01 morning run and removed by cmvs5k013000007lh0jlblw4c, 2026-10-28 09:31 ET.
WITH restored AS (
  UPDATE "Thesis"
  SET triggers = triggers || $j$[{"id": "65b20cc8-05d9-428a-a12c-4d72837da18d", "action": "REVIEW", "source": "AGENT", "fireMode": "NEXT_MORNING", "predicate": {"watch": "price", "is": "above", "value": 243}, "rationale": "the Oct. 6 recovery high at $243.37, rounded to $243, where the stock must prove it can resume the uptrend", "cooldownDays": 1}]$j$::jsonb,
      "targetPrice" = 243,
      "updatedAt" = now()
  WHERE id = 'cmtg9nbdy000204jpc6cwawgg'
    AND status = 'HOLDING'
    AND "targetPrice" IS NULL
    AND NOT (triggers @> $j$[{"id": "65b20cc8-05d9-428a-a12c-4d72837da18d"}]$j$::jsonb)
  RETURNING id
)
INSERT INTO "ThesisUpdate" (id, "thesisId", "timestamp", type, "fieldChanges", summary)
SELECT 'mfix' || md5(random()::text || clock_timestamp()::text), id, now(), 'UPDATED',
       $j${"triggerOps": {"from": null, "to": [{"id": "65b20cc8-05d9-428a-a12c-4d72837da18d", "op": "add", "text": "Added: Review if above $243"}]}, "targetPrice": {"from": null, "to": 243}}$j$::jsonb,
       $j$Restored: Review if above $243 (removed by an empty level in a save that kept it)$j$
FROM restored;

-- PLTR (HOLDING): Review if above $249.26. removed by cmvpaodut000707gqs8fhwbcl, 2026-10-26 09:31 ET.
WITH restored AS (
  UPDATE "Thesis"
  SET triggers = triggers || $j$[{"id": "390068f9-1b1a-4170-aaf2-a1b28a72da23", "action": "REVIEW", "source": "AGENT", "fireMode": "NEXT_MORNING", "predicate": {"watch": "price", "is": "above", "value": 249.26}, "rationale": "the standing multi-year upside review level from the prior valuation frame", "cooldownDays": 1}]$j$::jsonb,
      "targetPrice" = 249.26,
      "updatedAt" = now()
  WHERE id = 'cmqop233h000n04l57odbcpup'
    AND status = 'HOLDING'
    AND "targetPrice" IS NULL
    AND NOT (triggers @> $j$[{"id": "390068f9-1b1a-4170-aaf2-a1b28a72da23"}]$j$::jsonb)
  RETURNING id
)
INSERT INTO "ThesisUpdate" (id, "thesisId", "timestamp", type, "fieldChanges", summary)
SELECT 'mfix' || md5(random()::text || clock_timestamp()::text), id, now(), 'UPDATED',
       $j${"triggerOps": {"from": null, "to": [{"id": "390068f9-1b1a-4170-aaf2-a1b28a72da23", "op": "add", "text": "Added: Review if above $249.26"}]}, "targetPrice": {"from": null, "to": 249.26}}$j$::jsonb,
       $j$Restored: Review if above $249.26 (removed by an empty level in a save that kept it)$j$
FROM restored;

-- Check: each stock's levels and the restored triggers on its list.
SELECT t.ticker, t.status, t."entryPrice", t."targetPrice", t."stopLoss",
       (SELECT count(*) FROM jsonb_array_elements(t.triggers) x
         WHERE x->>'id' IN ('fd8ac088-1fba-4b7f-b792-c24727b2a7a9', '525fe4a5-37a2-46fe-83cd-269ba2e78ea3', '4710e772-f65f-4f81-810a-0ff74b206096', 'c857e10e-0c4c-491f-8a71-5a3c9b081a9e', '8733a7a7-9077-41d4-908b-99c5d70745b4', 'bb928325-0cde-4168-a03c-aca52371fc8f', '65b20cc8-05d9-428a-a12c-4d72837da18d', '390068f9-1b1a-4170-aaf2-a1b28a72da23')) AS restored_on_list
FROM "Thesis" t
WHERE t.id IN ('cmwfbxbuq000008kr9jw3zcv4', 'cmqb2ku1a000q04l6jtquuqr6', 'cmqb2nt4b001r04k0ahd3crrx', 'cmv9nm3xo000o06l3om8r7ath', 'cmtg9nbdy000204jpc6cwawgg', 'cmqop233h000n04l57odbcpup')
ORDER BY t.ticker;

-- COMMIT;   -- when the check reads: PRAX 351.75 / 392 / 236 with 3 on the list, the rest their target with 1.
ROLLBACK;
