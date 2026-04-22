# Run Failure Triage — Session 4 baseline

Status: **deferred** until at least 20 new FAILED runs ship with Session 4's
`parameters.toolStats` populated. This note captures what we know today and
what the next pass should look at.

## Why this is deferred

Fix 1 added the `toolStats` aggregator on 2026-04-22. Every `ResearchRun` row
created before then has `parameters.toolStats = null` (this is exactly what
the Session 4 audit measured and what the "Verify baseline" SQL confirmed
pre-deploy). Until new runs accumulate, there is nothing with the shape we
need to spot patterns in — `toolStats.failedToolCalls` only exists on
runs created after the deploy.

Per the Session 4 spec ("Don't chase rabbit holes"), we stop here instead of
spelunking through logs to reconstruct what `toolStats` would have shown.

## Baseline signal from the 2026-04-22 audit

Tech Momentum Trader (`cmmofy6t3000004l7858o1xma`) — last 5 runs:

| Status   | Duration   |
| :------- | :--------- |
| FAILED   | 27s        |
| FAILED   | 54s        |
| FAILED   | 85s        |
| COMPLETE | 54s        |
| COMPLETE | 61s        |

Short-duration FAILED runs (27–85s) point at bail-outs before Phase 5 rather
than mid-workflow stream errors. The existing `onFinish` already marks these
runs FAILED when thesisCount + tradeCount == 0; that's exactly the class of
failure we want `toolStats.failedToolCalls` to attribute to a tool or
prompt-stage drop.

## What to do on the next pass

Once ≥20 new FAILED runs exist:

```sql
SELECT id,
       parameters->'toolStats'->>'totalToolCalls' AS calls,
       parameters->'toolStats'->>'durationMs' AS duration_ms,
       parameters->'toolStats'->'failedToolCalls' AS failures
  FROM "ResearchRun"
 WHERE status = 'FAILED'
   AND parameters->'toolStats' IS NOT NULL
 ORDER BY "startedAt" DESC
 LIMIT 20;
```

Pattern-hunt:
1. **Most common failing tool** — bucket by `failures[].toolName`. One tool
   dominating means a single root cause (prompt/schema/API).
2. **Most common error message** — bucket by the first 120 chars of
   `failures[].error`. Repeated Zod shape errors point at the tool schema;
   repeated "rate limit" / "network" errors point at the provider.
3. **Thin-run cluster** — `totalToolCalls < 5` AND `durationMs < 60_000`
   means the agent bailed before Phase 5. Check `byTool` to see whether
   Phase 1 (intelligence reads) ever fired. If not, the drop is in the
   prompt handoff, not any individual tool.

If a single tool or error message owns ≥50% of failures, fix the root cause
inline. Otherwise, record findings and keep deferring — blanket rewrites of
the prompt stage have burned us before (see CLAUDE.md → "Stage structure in
the agent system prompt" recurring bug).

## Do not expand scope without checking in

If a cross-file pattern emerges that would require touching files outside
Session 4's scope (Session 3's schema, record-thesis, read-signals,
trade-evaluator), stop and raise before editing. Those are explicitly out of
this session's allowlist.
