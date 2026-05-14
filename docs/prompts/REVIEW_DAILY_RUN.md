# Daily Run Review — Session Prompt

You are reviewing the morning research runs for Hindsight. Your job is to produce a
structured run review that can serve as the baseline for the next review session.

## Before you start

Read these in order:

1. [`docs/run-reviews/TEMPLATE.md`](../run-reviews/TEMPLATE.md) — the report shape and all required sections
2. The most recent `docs/run-reviews/YYYY-MM-DD.md` — your prior baseline for delta columns
3. [`docs/GAPS.md`](../GAPS.md) — known open issues; flag any that appear (or fail to appear) in today's data

## What to query

Run all SQL blocks from the template's "Raw Queries" section, substituting today's date.
Specific things to check:

- `parameters.toolStats.byTool` in `ResearchRun.parameters` for every MORNING_PLAN run
- `RunEvent` rows for the failed runs (to distinguish quality-gate failures from runtime failures)
- `parameters.error` and `parameters.toolStats.totalToolCalls` for silent failures
- The overdue-review backlog query (trend over time)

## Canonical SQL

```sql
-- Morning runs
SELECT r.id, ac.name AS analyst, ac."useV2Prompt", r.status,
       (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') AS started_et,
       EXTRACT(EPOCH FROM (COALESCE(r."completedAt", NOW()) - r."startedAt"))::int AS elapsed_s,
       r.parameters->>'error' AS error_text,
       r.parameters->'toolStats'->>'totalToolCalls' AS total_tool_calls
FROM "ResearchRun" r
LEFT JOIN "AgentConfig" ac ON ac.id = r."agentConfigId"
WHERE r.mode = 'MORNING_PLAN'
  AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = CURRENT_DATE
ORDER BY r."startedAt";

-- Overdue-review backlog
SELECT
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING')) AS active_or_watching,
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING')
                   AND "nextReviewAt" < (NOW() - INTERVAL '7 days')) AS overdue_7d,
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING')
                   AND "nextReviewAt" < NOW()) AS overdue_any
FROM "Thesis";
```

## What to produce

Write to `docs/run-reviews/<today's date>.md` using the template structure.

Open one PR titled `docs(run-review): YYYY-MM-DD`. No code changes. Only the new `.md` file.
