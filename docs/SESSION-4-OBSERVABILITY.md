# Session 4 — Observability + Config Guard + Failure Triage

**Session 4 of 4.** Wave 2, runs parallel to Session 3 (Traceability). Prereqs: Wave 1 merged (routing + brief). Can be coded in parallel with Session 3, but the Monitor ROI table in fix #4 renders fields Session 3 creates — defensive-code with optional-chaining so this doesn't break if Session 3 hasn't merged when this ships.

## Before you start (required reading)

1. `CLAUDE.md` (full file) — stack, intelligence pipeline, analyst config
2. `docs/AGENT_OVERHAUL_PLAN.md` — Sessions 0 + 7 in particular (toolStats + UX polish)
3. `/Users/davebixler/.claude/projects/-Users-davebixler-hindsight/memory/project_pipeline_audit_2026_04_22.md`
4. Verify baseline SQL below before coding.

## Goal

Surface the pipeline's real state (dead crons, thin runs, zombie analysts, monitor ROI), auto-diagnose why runs are failing 60% of the time, and stop the builder from emitting contradictory analyst configs.

## Evidence the gaps exist (2026-04-22 audit)

- `ResearchRun.parameters.toolStats` is **null on every row** — no visibility into what the agent actually did during a run.
- Tech Momentum Trader (`cmmofy6t3000004l7858o1xma`) last 5 runs: 3 FAILED at 27–85s, 2 COMPLETE at 54–61s. No way to diagnose why without logs.
- TMT config: `marketCapMin: 500000000`, `marketCapMax: 10000000000` ($500M–$10B), watchlist = [AMD, TSM, ASML, NVDA, MSFT] (all $200B+). Watchlist bypasses the fence, but "discovery" is capped at mid-cap → impossible to find real peers of held names. Builder shipped a contradictory config.
- `/intelligence` exists but has no health surface — dead crons, signal funnel, ticker concentration, novelty distribution, monitor ROI all invisible.

## Files to touch

- `app/api/agent/[mode]/route.ts` — toolStats aggregator on `onStepFinish`
- `app/(root)/intelligence/health/page.tsx` — NEW dashboard
- `components/intelligence/` — NEW components (dead-cron table, signal funnel, novelty histogram, ticker concentration, monitor ROI table)
- `lib/agent/tools/suggest-config.ts` — builder validation
- `scripts/audit-analyst-configs.ts` — NEW one-shot to flag existing contradictions
- `app/(root)/runs/[id]/page.tsx` — small ToolStatsBlock component (optional if time)

## Scope — four fixes, one PR

### Fix 1: toolStats on every run (#10)

In `app/api/agent/[mode]/route.ts` inside the `streamText` config, hook `onStepFinish`. Aggregate `{ [toolName]: { count: number, totalLatencyMs: number, errors: number } }` across the run. Also track `failedToolCalls: []` with tool name + error message for the last 3 failures.

On run completion (`onFinish` or the existing completion path), write the aggregate into `ResearchRun.parameters` (merge into existing JSON, don't replace):

```ts
parameters: { ...existingParams, toolStats: aggregated }
```

Log a warning if `total_tool_calls < 5` or `duration_ms < 60_000` on a completed research-run. Don't block the run — just log.

### Fix 2: `/intelligence/health` dashboard (#11)

New route `app/(root)/intelligence/health/page.tsx`. Server component, queries Prisma directly. Four panels using ShadCN Card primitives only (no custom styling):

**Panel 1 — Dead Crons.** Table of all enabled Monitors with `lastRunAt` NULL or older than 48h. Columns: name, type, scope, `lastRunAt`, age.

**Panel 2 — Signal Funnel (last 24h).** Per analyst: signals routed → signals read → signals cited in theses (uses Session 3's `Thesis.sourceSignalIds` — defensive-read with `?? []`). Recharts bar chart or simple ShadCN table.

**Panel 3 — Ticker Concentration (last 7d).** Top 20 tickers by route count. Quick visual on whether the pipeline surfaces diverse names or the same 10.

**Panel 4 — Monitor ROI (when Session 3 has merged).** Table: monitor name, scope, tradesSourced, winsSourced, lossesSourced, successScore (sorted by successScore desc). Use `?.successScore ?? null` everywhere so this panel just shows "no data yet" if Session 3 hasn't shipped.

Also: **Novelty distribution histogram** (last 24h routes, bucketed 0–20, 21–40, 41–60, 61–80, 81–100) — quick visual diagnostic for whether routing collapsed.

All charts Recharts. All cards ShadCN. No custom styling.

### Fix 3: Config audit + builder validation (#5)

**One-shot script** `scripts/audit-analyst-configs.ts`. Run via `tsx scripts/audit-analyst-configs.ts`. For every `AgentConfig` where `enabled = true`:

- If watchlist is non-empty AND (`marketCapMax IS NOT NULL` AND there's a likely $200B+ name in watchlist that would exceed max — use hardcoded ticker → market-cap lookup table for the common names, or fetch from Finnhub), emit a warning with analyst name + offending ticker + fence range.
- If `sectors OR industries` non-empty AND `themes` empty AND analyst name contains themey keywords ("momentum", "AI", "EV", "biotech"), warn "likely missing themes".
- If `minConfidence > 80`, warn "unusually high threshold".

Output a table to stdout. Don't auto-fix — user reviews.

**Builder validation.** In `lib/agent/tools/suggest-config.ts` where the tool's `execute()` validates the proposed config before persisting: add a same-logic check that rejects a config if the proposed watchlist contains tickers outside the proposed fence. Error message: "Watchlist includes $NVDA ($3T) but marketCapMax is set to $10B. Either widen the fence or remove oversized tickers from the watchlist."

### Fix 4: Run failure triage (#8)

Once Fix 1 is live, any new failed run will have `parameters.toolStats` populated. Within this session's scope:

1. Query last 20 FAILED runs, examine `toolStats.failedToolCalls` for patterns (most common failing tool, most common error message).
2. If a pattern jumps out (e.g. every failure is a `record_thesis` schema error), fix the root cause inline — likely a prompt or Zod schema issue.
3. If no pattern, write a short `docs/RUN-FAILURE-NOTES.md` with raw findings and defer. Don't chase rabbit holes.

## Verify baseline (run before coding)

```sql
-- Prove #10
SELECT COUNT(*) FROM "ResearchRun" WHERE "parameters"->'toolStats' IS NOT NULL;
-- Expect: 0

-- Prove #8
SELECT status, COUNT(*), AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt"))) AS avg_seconds
FROM "ResearchRun" WHERE "createdAt" > NOW() - INTERVAL '14 days' GROUP BY status;
-- Expect: FAILED rows with very short durations, no tool_stats

-- Prove #5
SELECT name, watchlist, "marketCapMin", "marketCapMax", themes
FROM "AgentConfig" WHERE enabled = true;
-- Inspect for contradictions manually.
```

## Verify success (after coding)

1. Kick a manual run for any enabled analyst. After completion: `SELECT "parameters"->'toolStats' FROM "ResearchRun" WHERE id = ...;` — expect populated JSON.
2. Visit `/intelligence/health` — all four panels render with real data.
3. `tsx scripts/audit-analyst-configs.ts` — TMT flagged with the fence vs watchlist contradiction, plus any other analysts with similar issues.
4. Attempt to save a suggest_config with watchlist=["NVDA"] + marketCapMax=10B via the builder — rejected with clear error.

## Out of scope

- Router scoring (Session 1 shipped)
- Brief generator (Session 2 shipped)
- Schema changes to Thesis / Monitor (Session 3's job) — this session just reads those fields defensively
- Manager agent / Suggestion model / PR #156 work
- Analyst detail revision history UI
- Performance page accuracy dimensions
- Auto-repair of flagged analyst configs — surface only, user repairs manually via editor

## Commit

`feat(observability): toolStats + /intelligence/health + config audit + builder validation`

## Notes

- `/intelligence/health` should be accessible but not yet replace `/intelligence` main view. Consider a sub-nav toggle.
- If Fix 4's pattern-hunt finds an actual root cause that needs a cross-file fix, STOP and ask before expanding scope. Log findings, commit what's done, follow up.
