-- dedupe_folded_fire_rows.sql — delete the per-tick "folded into the sell"
-- activity rows. All of them.
--
-- STATUS: not yet run. Operator-run, destructive (deletes activity rows) —
-- run the verify SELECT first.
--
-- Context (2026-08-26): while a proposed sell sat awaiting approval, the
-- 5-minute price checker re-fired the protective trigger on every tick and
-- tactical-run wrote an activity row for EVERY fold — EME's trailing trigger
-- alone put 500+ identical "exit position" rows on one thesis. The rule now
-- (tactical-run.ts, same-day change): proposal open = trigger's job done =
-- silent — no row, no write. The pending proposal is the record; expiry →
-- re-propose is the daily heartbeat. So the fold rows carry no information
-- at all and every one of them goes. Proposal-creation rows don't match the
-- '— folded into the' summary and are never touched.
--
-- Verify first — how many rows this removes, by stock:
--
--   select t.ticker, count(*)
--   from "ThesisUpdate" u join "Thesis" t on t.id = u."thesisId"
--   where u.type = 'TRIGGER_FIRED' and u.summary like '%— folded into the%'
--   group by 1 order by 2 desc;

begin;

delete from "ThesisUpdate"
where type = 'TRIGGER_FIRED'
  and summary like '%— folded into the%';

commit;

-- After: the EME/MU Activity tabs should show one proposal per day while a
-- sell sat unactioned — nothing else.
