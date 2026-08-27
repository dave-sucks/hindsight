-- fix_entry_price_approval_fills.sql — set two theses' buy price to what
-- was actually paid.
--
-- STATUS: not yet run. Operator-run, any time; safe to re-run (each UPDATE
-- is guarded on the exact stale value).
--
-- Context (found by the 2026-08-26 daily levels check, CHECK_LEVELS_DAILY
-- check 6): buys that fill through the approval queue never re-stamped the
-- thesis buy price with the fill. At approve time the thesis got the
-- PROPOSED price; reconcile-orders then corrected Position.avgCost with the
-- real fill but never touched the thesis. The code fix adds the stamp to
-- reconcile-orders (restampThesisEntryOnFill); this heals the two rows that
-- predate it:
--
--   PBH   thesis said $51.68   — actually paid $52.975  (filled 2026-08-24)
--   ANET  thesis said $186.45  — actually paid $183.827484 (filled 2026-08-20)
--
-- The trigger evaluator measures gains off Position.avgCost (live), so the
-- protective math was never wrong — this fixes what the sheet shows and
-- what the agent reads via get_theses.
--
-- Verify first — expect exactly the two rows above:
--
--   select t.id, t.ticker, t."entryPrice", p."avgCost"
--   from "Thesis" t join "Position" p
--     on p.symbol = t.ticker and p.status = 'OPEN' and p."accountId" = t."accountId"
--   where t.status = 'HOLDING' and t.ticker in ('PBH', 'ANET');

begin;

update "Thesis"
set "entryPrice" = 52.975
where id = 'cmt0zqtsl000a04l5oj023qic'   -- PBH
  and "entryPrice" = 51.68;

update "Thesis"
set "entryPrice" = 183.827484
where id = 'cmt0zqjmc000504l5zq6djk32'   -- ANET
  and "entryPrice" = 186.45;

insert into "ThesisUpdate" (id, "thesisId", type, summary, rationale, "fieldChanges", "signalIds")
select 'mfix-pbh-entry-20260826', 'cmt0zqtsl000a04l5oj023qic', 'UPDATED',
       'PBH buy price set to what was paid — $52.98',
       'Manual heal: the buy filled at $52.975 through the approval queue, which never re-stamped the thesis (fixed in reconcile-orders the same day). The thesis carried the planned $51.68.',
       '{"entryPrice": {"from": 51.68, "to": 52.975}}'::jsonb, '{}'
where not exists (select 1 from "ThesisUpdate" where id = 'mfix-pbh-entry-20260826');

insert into "ThesisUpdate" (id, "thesisId", type, summary, rationale, "fieldChanges", "signalIds")
select 'mfix-anet-entry-20260826', 'cmt0zqjmc000504l5zq6djk32', 'UPDATED',
       'ANET buy price set to what was paid — $183.83',
       'Manual heal: the buy filled at $183.827484 through the approval queue, which never re-stamped the thesis (fixed in reconcile-orders the same day). The thesis carried the planned $186.45.',
       '{"entryPrice": {"from": 186.45, "to": 183.827484}}'::jsonb, '{}'
where not exists (select 1 from "ThesisUpdate" where id = 'mfix-anet-entry-20260826');

commit;

-- After: re-run the verify SELECT — entryPrice and avgCost should match to
-- the cent, and CHECK_LEVELS_DAILY check 6 should return zero rows.
