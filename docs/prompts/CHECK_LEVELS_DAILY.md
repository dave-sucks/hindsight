# Daily check — did the levels work?

> Run this after the morning runs, every day, until it comes back clean twice
> in a row. Shipped 2026-08-25 (DAV-195). Delete this file when it stops
> finding anything.
>
> Plain-language rule for this doc: **stocks, watchlist, holdings, triggers,
> theses, analysts, runs, buy price, floor, target.** Nothing else.

---

## What changed, in one paragraph

Every price written on a thesis — the buy price, the floor, the target — used
to be text on a screen. Some of them did something; most didn't. Now all of
them do. A floor on a stock you hold puts a sell in your approval queue. A
target on a stock you hold flags it for the morning run to decide. A floor or
target on a **watchlist** stock takes the plan off it (the three numbers are
removed, the stock stays on the list, tomorrow's run is told to re-price it or
drop it).

Review timing also moved: it used to be a date somebody typed on each thesis,
now it's a trigger — *review every N days* — counted from the last time an
analyst actually looked. Catalysts daily, compounders monthly, everything
else weekly.

---

## Check 1 — did the deploy actually land

**Do this first. It is the only failure with no error message anywhere.**

Merging is not deploying. Vercel's GitHub app has dropped a push before
(PR #268, zero deploy, next push recovered). If it drops this one, the
database changes never run, and the result is: **the morning runs quietly
review nothing.** No error, no failed job, no red anything. Just silence.

```bash
gh api repos/dave-sucks/hindsight/commits/main --jq '.sha' \
  | xargs -I{} gh api repos/dave-sucks/hindsight/commits/{}/status --jq '.state'
```

Then prove the review timing actually got written:

```sql
-- Should be 27+, not 0. Zero means the deploy didn't run.
select count(*) from "Thesis"
where triggers::text like '%REVIEW_CADENCE%' and status in ('HOLDING','WATCHING');

-- Both accounts should have one too.
select count(*) from "Account" where triggers::text like '%REVIEW_CADENCE%';
```

**If either is zero: the deploy didn't land. Re-push to trigger it.** Don't
debug anything else until this is non-zero.

---

## Check 2 — did the morning runs review a normal number of theses

The single best signal. If the review timing didn't seed, runs will look
*successful* and do almost nothing.

```sql
select r."createdAt"::date as day, c.name as analyst,
       count(*) filter (where u.type in ('REVIEWED','UPDATED')) as reviewed
from "ResearchRun" r
join "AgentConfig" c on c.id = r."agentConfigId"
left join "ThesisUpdate" u on u."runId" = r.id
where r."createdAt" > now() - interval '2 days'
group by 1,2 order by 1 desc, 2;
```

Compare against the week before. **A run that reviewed 0–1 theses is the
failure**, not a quiet day.

---

## Check 3 — which watchlist plans came off, and were they right to

Expect a handful on day one: any watchlist stock already past its target or
below its floor loses its plan immediately. That is the KLAC and NTNX
backlog finally clearing, not a bug.

```sql
select t.ticker, u."timestamp", u.summary
from "ThesisUpdate" u join "Thesis" t on t.id = u."thesisId"
where u.summary like '%plan set down%' and u."timestamp" > now() - interval '2 days'
order by u."timestamp" desc;
```

**Read each one.** The question is whether you agree the plan was dead. If a
plan came off a stock you still want priced, the number was wrong, not the
system — re-price it on the thesis sheet.

Known: **MSFT** is watching with a buy at $418.57 and a target of $500. If it
trades above $500 the plan comes off. Expected.

---

## Check 4 — no sell proposals on stocks you don't own

This should be **zero, always**. A floor breaking on a watchlist stock takes
the plan off; it must never propose a sale of something you never bought.

```sql
select o.id, o.symbol, o.intent, o."createdAt"
from "Order" o
left join "Position" p on p.id = o."positionId" and p.status = 'OPEN'
where o.intent in ('CLOSE','PARTIAL_CLOSE')
  and o."createdAt" > now() - interval '2 days'
  and p.id is null;
```

**Any row here is a real bug.** Report it with the ticker.

---

## Check 5 — the numbers on screen match the triggers

The whole point. A thesis whose floor column disagrees with its floor trigger
is the old bug coming back.

```sql
select t.ticker, t.status, t."stopLoss" as shown,
       (select r->'predicate'->>'level' from jsonb_array_elements(t.triggers) r
        where r->>'action'='EXIT' and r->'predicate'->>'kind'='PRICE_BELOW'
        order by (r->'predicate'->>'level')::numeric desc limit 1) as fires_at
from "Thesis" t
where t.status in ('HOLDING','WATCHING') and t.direction='LONG'
  and t."stopLoss" is not null
  and t."stopLoss"::text <> coalesce((select r->'predicate'->>'level'
        from jsonb_array_elements(t.triggers) r
        where r->>'action'='EXIT' and r->'predicate'->>'kind'='PRICE_BELOW'
        order by (r->'predicate'->>'level')::numeric desc limit 1),'');
```

Expect zero. **One exception that is fine:** a stock you hold can show a
higher floor on the card than in this column, because the account's 8%
give-back rule moves with the stock's high and the card shows whichever
floor is closer. The card is right.

---

## Check 6 — entry price is what you paid

Broken twice during this work. Worth checking once.

```sql
select t.ticker, t."entryPrice" as thesis_says, p."avgCost" as actually_paid
from "Thesis" t join "Position" p
  on p.symbol = t.ticker and p.status='OPEN' and p."accountId" = t."accountId"
where t.status='HOLDING'
  and (t."entryPrice" is null or abs(t."entryPrice" - p."avgCost") > 0.01);
```

Expect zero rows.

---

## Known, accepted, not bugs

- **Review triggers are labelled "TACTICAL" but never wake an agent.** The
  evaluator sends every review to the next morning run instead. The label is
  wrong, the behaviour is right. One-line cleanup, filed as a follow-up.
- **`Position.stopLoss` / `targetPrice` still exist and are ignored.** Nothing
  decides on them. Removal needs three agent-facing readers repointed first.
- **A thesis promoted between horizons keeps its old review timing.** Change a
  compounder to a trade and it still reviews monthly until someone edits it.
- **The 5-day and 30-day price-move triggers are gone.** They never worked —
  the price checker only ever has today's price. Four theses carried one.

## The one to watch when Signals is rebuilt (DAV-196)

Reviews are sent to the morning run instead of waking an agent — that's what
keeps a big watchlist cheap. There is **one exception**: a review triggered by
a `BREAKING`-urgency news signal still wakes an agent immediately.

That's dormant today because signal routing is paused. When DAV-196 turns it
back on, and DAV-209 grows the watchlist, that is the single path where the
May 2026 problem could return — dozens of agent runs in a day, no decisions
made. Check it before shipping DAV-196.
