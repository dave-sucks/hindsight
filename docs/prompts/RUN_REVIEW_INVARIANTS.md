# Run review — the invariants, checked first, every time

Run these before reading anything else. Each one is a fact about the production
database that must hold; each has a one-line "what bad looks like". They take
about two minutes through the Supabase SQL tool. The long rubric in
`REVIEW_DAILY_RUN.md` is for judging *quality*; this file is for catching
*breakage*, and breakage hid for weeks in September 2026 because nobody ran
these (FMP dead since Aug 19 with "all sources ok" in every log; every thesis
write failing for four hours with "Thesis persisted" in the log).

Substitute today's date. All times stored UTC; `- interval '4 hours'` gives ET
in summer (5 in winter).

## 1. Did the runs happen, finish, and write anything?

```sql
SELECT rr.id, rr.mode, rr.status, ac.name, rr."createdAt" - interval '4 hours' AS et,
  (SELECT count(*) FROM "ThesisUpdate" tu WHERE tu."runId"=rr.id) AS audit_rows
FROM "ResearchRun" rr LEFT JOIN "AgentConfig" ac ON ac.id=rr."agentConfigId"
WHERE rr."createdAt" > '<today> 04:00:00+00' ORDER BY rr."createdAt";
```
Bad: a run day (Mon/Wed/Fri) with no MORNING_PLAN per enabled analyst; any
FAILED; a COMPLETE THESIS_WRITER with `audit_rows = 0` (it saved nothing).

## 2. Did any save fail on the database itself?

```sql
SELECT count(*) FROM "RunEvent" WHERE "createdAt" > '<today> 04:00:00+00'
  AND (message ILIKE '%does not exist%' OR message ILIKE '%P2022%' OR message ILIKE '%prisma%');
SELECT "createdAt", tool, "gateCode", left(detail,160) FROM "GateRejection"
  WHERE "gateCode"='__exception__' AND "createdAt" > now() - interval '3 days';
```
Bad: anything. An `__exception__` receipt is a tool that threw, not a rule that
refused.

## 3. Did the writer get data, and did it say so honestly?

```sql
SELECT rr.parameters->>'ticker' AS ticker, rr.status,
  (SELECT left(re.message,140) FROM "RunEvent" re WHERE re."runId"=rr.id AND re.title='Data pulled' LIMIT 1) AS pulled,
  (SELECT re.title FROM "RunEvent" re WHERE re."runId"=rr.id AND re.title IN ('Thesis persisted','Persist refused','Research failed') ORDER BY re."createdAt" DESC LIMIT 1) AS outcome
FROM "ResearchRun" rr WHERE rr.mode='THESIS_WRITER' AND rr."createdAt" > '<today> 04:00:00+00';
```
Bad: `pulled` naming an empty source on a US large-cap; "Thesis persisted" with
status FAILED or vice versa. Expected: "all sources returned data", or a named
empty with a reason you can explain (foreign filers have no US filings —
ASML shows `financials(empty)`).

## 4. Book shape — every held and watched name

```sql
WITH th AS (SELECT t.ticker, t.status, t.direction, t."entryPrice" e, t."targetPrice" tg, t."stopLoss" s, COALESCE(t.triggers,'[]'::jsonb) tr FROM "Thesis" t WHERE t.status IN ('HOLDING','WATCHING'))
SELECT ticker, status, e, tg, s,
 (SELECT count(*) FROM jsonb_array_elements(tr) x WHERE x->>'action'='ENTER') AS n_enter,
 (SELECT count(*) FROM jsonb_array_elements(tr) x WHERE x->>'action'='EXIT') AS n_exit,
 (SELECT count(*) FROM jsonb_array_elements(tr) x WHERE x->>'action' IN ('ADD','TRIM','MOVE_STOP')) AS n_pos,
 (SELECT count(*) FROM jsonb_array_elements(tr) x WHERE x->'predicate'->>'kind'='REVIEW_CADENCE') AS n_clock,
 CASE WHEN direction='LONG' AND e>s THEN round(((tg-e)/(e-s))::numeric,2) END AS rr,
 (SELECT count(*) FROM "Position" p WHERE p.symbol=th.ticker AND p.status='OPEN') AS open_pos
FROM th ORDER BY status, ticker;
```
Bad, by column:
- WATCHING with `rr < 2` — a plan under the floor (the gate should have refused it; find the write path that let it through).
- WATCHING with `n_enter > 1` — two buy triggers on one stock.
- WATCHING with `n_pos > 0` — a scale-in/trim rung on a name we don't own (read side drops it, but it shouldn't be stored).
- HOLDING with `n_exit = 0` — an owned name with no sell rung.
- HOLDING with `open_pos = 0`, or WATCHING with `open_pos = 1` — position/thesis desync.
- A stop **above** entry on a WATCHING row (fine on HOLDING — that's a ratcheted stop).

## 5. Positions and theses agree

```sql
SELECT (SELECT count(*) FROM "Position" WHERE status='OPEN') AS open_positions,
 (SELECT count(*) FROM "Position" p WHERE p.status='OPEN' AND NOT EXISTS (SELECT 1 FROM "Thesis" t WHERE t.ticker=p.symbol AND t.status='HOLDING')) AS pos_without_holding,
 (SELECT count(*) FROM "Thesis" t WHERE t.status='HOLDING' AND NOT EXISTS (SELECT 1 FROM "Position" p WHERE p.symbol=t.ticker AND p.status='OPEN')) AS holding_without_pos;
```
Bad: either count above zero.

## 6. What fired, and did it fire the right way?

```sql
SELECT t.ticker, t.status, (tu."timestamp" - interval '4 hours')::date AS day, count(*) AS n, string_agg(DISTINCT left(tu.summary,60), ' | ')
FROM "ThesisUpdate" tu JOIN "Thesis" t ON t.id=tu."thesisId"
WHERE tu.type::text='TRIGGER_FIRED' AND tu."timestamp" > now() - interval '7 days'
GROUP BY 1,2,3 ORDER BY 3 DESC, n DESC;
```
Bad: the same buy trigger firing on consecutive days while the price sits past
its level (buys fire on the crossing only); a "scale in" on a WATCHING row; two
runs spawned for one stock in the same minute for the same action.

## 7. Refusals — what the rules stopped, and whether the agent then did something sensible

```sql
SELECT g."createdAt" - interval '4 hours' AS et, g.tool, g."gateCode", g.ticker, ac.name, left(coalesce(g.detail,g.summary),200)
FROM "GateRejection" g LEFT JOIN "AgentConfig" ac ON ac.id=g."analystId"
WHERE g."createdAt" > '<today> 04:00:00+00' ORDER BY g."createdAt";
```
Then read the next ThesisUpdate on the same stock. Bad: the agent archived the
name, or moved a different number, to get past the rule (the "move the bar"
shape). Good: it fixed the level, set the plan down, or left it and said why.

## 8. Money paid for research that was thrown away

```sql
SELECT t.ticker, tu.type, tu."timestamp" - interval '4 hours' AS et, left(tu.summary,90)
FROM "ThesisUpdate" tu JOIN "Thesis" t ON t.id=tu."thesisId"
WHERE tu."timestamp" > '<today> 04:00:00+00' AND t.ticker IN (
  SELECT DISTINCT t2.ticker FROM "ThesisUpdate" u2 JOIN "Thesis" t2 ON t2.id=u2."thesisId"
  WHERE u2.type::text='STATUS_CHANGED' AND u2."timestamp" > '<today> 04:00:00+00')
ORDER BY t.ticker, tu."timestamp";
```
Bad: a writer refresh landing and the same stock being RETIRED minutes later
(TOST 2026-09-09: researched 08:09:35, archived 08:09:48).

## 9. Orders and proposals

```sql
SELECT symbol, side, status, "createdAt" - interval '4 hours' AS et, "closeReason", left(rationale,100)
FROM "Order" WHERE "createdAt" > '<today> 04:00:00+00' ORDER BY "createdAt";
```
Pending approvals are the app working — not a finding. Bad: two orders for one
stock seconds apart (double spawn); a buy REJECTED with a reason that was true
when the plan was written (see the Activity feed's "Buy blocked" rows).

## 10. Discovery actually runs

```sql
SELECT count(*) FILTER (WHERE "createdAt" > now() - interval '14 days') AS last_2w, max("createdAt") AS last_ever
FROM "ResearchRun" WHERE mode='DISCOVERY';
```
Bad: `last_2w = 0` after a Sunday. (Zero since 2026-05-31 as of this writing —
the Inngest function is paused or unregistered; DAV-231.)

## 11. Schema and database agree

```sql
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;
```
Compare against `prisma/migrations/` on main. Then, for any column a recent PR
dropped: `git grep <column> prisma/schema.prisma` must be empty. Bad: a drop
migration applied while the field is still in the schema (2026-09-08).

## 12. Analyst settings are what the principal thinks they are

```sql
SELECT name, "minConfidence", "minPositionSize", "maxPositionSize", "maxPositionTotal", "runDaysOfWeek", "tradingEnvironment"
FROM "AgentConfig" WHERE enabled ORDER BY name;
```
Bad: a minimum confidence no watch plan can clear (compare against `scoring->>'composite' * 10`
on the analyst's WATCHING rows); smallest = largest trade when a conviction band was intended.

---

**If all twelve hold, then read the quality rubric.** If any fails, that is the
review's first finding, and the fix goes in Linear before any quality note.
