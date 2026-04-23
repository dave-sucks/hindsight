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

## Domain monitor silent cron

**Symptom.** `SELECT COUNT(*) FROM "SignalBatch" WHERE "jobType" = 'DOMAIN_MONITOR'`
returns 0 forever. Every one of the 27 enabled DOMAIN monitors still has
`lastRunAt = NULL`.

**What's been ruled out.**
- The function exists (`lib/inngest/functions/domain-monitor.ts`).
- It's registered in `app/api/inngest/route.ts`.
- The cron spec (`TZ=America/New_York 15 7 * * 1-5`) parses and matches the
  other four intelligence crons that do run.
- Code path to `createSignalBatch` was clean — if the function had executed,
  a SignalBatch row would exist even on Sonar failure, because batch
  creation came before the per-monitor search step.

So this is not a code bug inside the handler. The function is never being
invoked. That narrows it to the Inngest layer: registration gap, missing
event-key wiring in the deployed environment, cron-schedule conflict, or
the Inngest deployment is simply not aware of this function.

**Diagnostic added in this PR.**
1. `console.log("[domain-monitor] invoked at <ts>, scope=<cron|event>")` is
   the first line inside the async handler, before any `step.run`. Inngest
   surfaces `console.log` in the run stream — if you see this line in the
   dashboard, the function started. If you don't, Inngest never routed the
   trigger to the handler.
2. `createSignalBatch("DOMAIN_MONITOR")` is hoisted out of `step.run` and
   called unconditionally at the top. This costs us duplicate batch rows on
   retries (accepted) in exchange for unambiguous evidence: a SignalBatch
   row means the handler's top-level code ran; no row means the handler
   never ran at all. There's no middle state anymore.
3. `retries` bumped from 1 → 3 so a first transient Sonar/Firecrawl failure
   stops eating every subsequent invocation on that run.
4. Smoke-test script `scripts/trigger-domain-monitor.ts` sends the
   `intelligence/domain-monitor` event. Run it, then check SignalBatch:

   ```sh
   npx tsx scripts/trigger-domain-monitor.ts
   ```

   ```sql
   SELECT id, status, "startedAt"
     FROM "SignalBatch"
    WHERE "jobType" = 'DOMAIN_MONITOR'
    ORDER BY "startedAt" DESC LIMIT 5;
   ```

**Reading the result.**
- New SignalBatch row + log line visible → event delivery works. Problem is
  cron-registration: inspect the Inngest Cloud dashboard → Functions →
  "Domain Monitors" → Cron tab; the cron schedule entry may be missing,
  paused, or registered under a stale app ID.
- No SignalBatch row and no log line → event delivery is also broken. Check
  `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` in Vercel, and confirm the
  Inngest app is still registered against the production serve endpoint at
  `/api/inngest`. Compare to `intelligence/market-sweep` which does run; if
  only one of the five intelligence events is missing, it's most likely a
  per-function registration issue in the Inngest dashboard.

Follow-up belongs outside PR #170 — these four changes only add diagnostic
visibility and can't fix an infra-layer gap.
