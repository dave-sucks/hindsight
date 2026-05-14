# Discovery Run Review — Session Prompt

You are writing a pre-run expectations doc for an upcoming discovery cron run. Your job
is to commit in writing what the run SHOULD produce for one anchor ticker, then compare
actual results after the run completes.

## Before you start

Read these in order:

1. [`docs/discovery-reviews/TEMPLATE.md`](../discovery-reviews/TEMPLATE.md) — the expectations doc structure and naming convention
2. The most recent `docs/discovery-reviews/YYYY-MM-DD-TICKER.md` — example of a completed review
3. [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — the thesis state machine; confirms what "correct" discovery output looks like
4. [`docs/GAPS.md`](../GAPS.md) — any open gaps that affect discovery behavior (P1-9 archetype-blind prompt is relevant)

## Naming convention

`YYYY-MM-DD-TICKER.md` — the date the review was written (pre-run), the anchor ticker.
Example: `2026-05-13-INTC.md`.

## Choosing an anchor ticker

Good anchor criteria:
- High signal density in the past 7 days (query `AnalystSignalRoute` for the top uncovered tickers)
- Mixed sentiment signals (bullish AND bearish) — forces the agent to score rigorously
- Squarely in the target analyst's universe (sector/industry match, not on watchlist, not already covered)
- Clear expected outcome from the scoring rubric (WATCHING vs PASS is pre-determinable)

## What to query (pre-run)

```sql
-- Top uncovered tickers by signal count (past 7 days)
SELECT
  unnest(s.tickers) AS ticker,
  COUNT(DISTINCT asr.id) AS route_count,
  COUNT(DISTINCT asr."analystId") AS analyst_count,
  array_agg(DISTINCT s.sentiment) AS sentiments
FROM "Signal" s
JOIN "AnalystSignalRoute" asr ON asr."signalId" = s.id
WHERE s."createdAt" > NOW() - INTERVAL '7 days'
  AND NOT EXISTS (
    SELECT 1 FROM "Thesis" t
    WHERE t.ticker = unnest(s.tickers)
      AND t.status IN ('WATCHING','ACTIVE')
  )
GROUP BY ticker
ORDER BY route_count DESC
LIMIT 20;

-- Confirm no existing coverage on the anchor ticker
SELECT id, ticker, direction, status, "analystId"
FROM "Thesis"
WHERE ticker = '<TICKER>'
  AND status IN ('WATCHING', 'ACTIVE');
```

## What to produce (pre-run)

Write `docs/discovery-reviews/<YYYY-MM-DD>-<TICKER>.md` using the template. Commit every
expected field value you can derive before the run. The sharper your pre-commit, the more
useful the post-run comparison.

After the run, add a "## Post-run comparison" section to the same file:
- What matched the expectation
- What diverged (and whether it's a bug or a documented intentional difference)
- Any new failure points to add to the template's "failures to watch" list

Open one PR titled `docs(discovery-review): YYYY-MM-DD-TICKER`. No code changes.
