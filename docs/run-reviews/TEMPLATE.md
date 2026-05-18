# Run Review — YYYY-MM-DD

> Prior baseline: [YYYY-MM-DD](./YYYY-MM-DD.md). Delta columns compare against that report.

## TL;DR

1-2 paragraph summary of the day's runs. Lead with the failure count and any regressions vs prior. Note if a specific analyst or bug class dominated.

## Daily Metrics

| Metric | Today | Prior | Delta |
|--------|-------|-------|-------|
| Morning runs (total / OK / fail) | | | |
|   V1 morning (total / OK / fail) | | | |
|   V2 morning (total / OK / fail) | | | |
| Tactical (total / OK / fail) | | | |
| Discovery (total / OK / fail) | | | |
| Trades placed | | | |
| Positions closed | | | |
| Daily-run `record_thesis` calls * | | | |
| Daily-run `manage_watchlist` calls * | | | |
| Daily-run `close_position` calls | | | |
| Daily-run `manage_position` calls | | | |
| Daily-run `update_thesis` calls | | | |
| Daily-run `get_stock_data` calls | | | |
| Daily-run `place_trade` calls | | | |
| `NEAR_TARGET`/`NEAR_STOP` writes * | | | |
| Overdue-review backlog (>7d, ACTIVE+WATCHING) | | | |
| Overdue-review backlog (any, ACTIVE+WATCHING) | | | |

\* should be 0 post-PR-#244

## V2 Behavior

Per-analyst walkthrough for analysts on the V2 prompt. Note: run ID, status, elapsed, tool call count, key flow events (parallel opens, research-before-trade, per-thesis closeout, record_run_summary quality). Flag ✓/✗ for each expected behavior.

## Failures

| Run | Mode | Prompt | Category | Root cause from `parameters.error` / events |
|-----|------|--------|----------|----------------------------------------------|
| | | | | |

Categories: `Code/runtime — silent timeout`, `Code/runtime — exception`, `Quality gate — narration→execution`, `Quality gate — promotion`, `Quality gate — complete_run preflight`.

## New Findings

Observations not present in prior run reviews. Include: new failure patterns, unexpected tool call sequences, gate behavior worth noting, data anomalies (e.g. price feed oddities).

## Trends vs Prior Report

Directional commentary on the metrics delta. E.g. "Overdue-review backlog draining: 19→13 (>7d)." Note if a prior Open Question is now answered.

## Open Questions

Numbered list of things to investigate before the next review. Each should be answerable by SQL query, log inspection, or code read — not speculation.

## Raw Queries

```sql
-- Morning runs today
SELECT r.id, ac.name AS analyst, ac."useV2Prompt", r.status,
       (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') AS started_et,
       EXTRACT(EPOCH FROM (COALESCE(r."completedAt", NOW()) - r."startedAt"))::int AS elapsed_s,
       r.parameters->>'error' AS error_text
FROM "ResearchRun" r
LEFT JOIN "AgentConfig" ac ON ac.id = r."agentConfigId"
WHERE r.mode = 'MORNING_PLAN'
  AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE 'YYYY-MM-DD'
ORDER BY r."startedAt";

-- Tactical runs today
SELECT r.id, ac.name AS analyst, r.parameters->>'ticker' AS ticker,
       r.parameters->>'predicateKind' AS predicate_kind,
       r.parameters->>'action' AS action, r.status,
       EXTRACT(EPOCH FROM (COALESCE(r."completedAt", NOW()) - r."startedAt"))::int AS elapsed_s,
       r.parameters->>'error' AS error_text
FROM "ResearchRun" r
LEFT JOIN "AgentConfig" ac ON ac.id = r."agentConfigId"
WHERE r.mode = 'INTRADAY_TACTICAL'
  AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE 'YYYY-MM-DD'
ORDER BY r."startedAt";

-- Per-tool totals across MORNING_PLAN runs today
WITH today_morning_runs AS (
  SELECT r.id FROM "ResearchRun" r
  WHERE r.mode = 'MORNING_PLAN'
    AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE 'YYYY-MM-DD'
),
toolcall_rows AS (
  SELECT (regexp_matches(rm.content, '"type":"tool-call","toolCallId":"[^"]+","toolName":"([^"]+)"', 'g'))[1] AS tool_name
  FROM today_morning_runs tr JOIN "RunMessage" rm ON rm."runId" = tr.id
)
SELECT tool_name, COUNT(*) AS n FROM toolcall_rows GROUP BY tool_name ORDER BY n DESC;

-- Fix #0: NEAR_TARGET / NEAR_STOP rows today
SELECT COUNT(*) FROM "PositionManagementAction"
WHERE ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE 'YYYY-MM-DD'
  AND "actionType" IN ('NEAR_TARGET','NEAR_STOP');

-- Trades + closes today
SELECT symbol, direction, status, quantity, "avgCost", "openedAt",
       "closedAt", "closeReason", "closeSource", "realizedPnl"
FROM "Position"
WHERE ("openedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE 'YYYY-MM-DD'
   OR ("closedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE 'YYYY-MM-DD'
ORDER BY COALESCE("closedAt", "openedAt");

-- Overdue-review backlog
SELECT
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING')) AS active_or_watching,
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING')
                   AND "nextReviewAt" < (NOW() - INTERVAL '7 days')) AS overdue_7d,
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING')
                   AND "nextReviewAt" < NOW()) AS overdue_any
FROM "Thesis";

-- RunEvent details (to distinguish true failures from quality-gate failures)
SELECT "runId", type, title, LEFT(message, 300) AS msg, "createdAt"
FROM "RunEvent"
WHERE "runId" IN (<today's morning run ids>)
ORDER BY "runId", "createdAt";
```
