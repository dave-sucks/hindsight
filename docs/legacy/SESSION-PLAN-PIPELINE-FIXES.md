# Pipeline Fixes — 4-Session Plan (2026-04-22)

**Status:** in flight. 12 issues split across 4 sessions, 2 parallel waves.

## Issues being addressed

Surfaced in the 2026-04-22 audit of Tech Momentum Trader. Full evidence in `/Users/davebixler/.claude/projects/-Users-davebixler-hindsight/memory/project_pipeline_audit_2026_04_22.md`.

| # | Issue | Session |
|---|---|---|
| 1 | Novelty multiplier obliterates real breakouts (WLDS +49% scored 4 vs scam email scored 26) | 1 |
| 2 | Novelty never denormalized to `Signal.noveltyScore` (100% rows stuck at default 50) | 1 |
| 3 | Brief fabricates signalIds from stale multi-day pool | 2 |
| 4 | Brief ignores `intelligencePolicy.holdingsAttention` — empty `portfolioAlerts` on position days | 2 |
| 5 | Builder emits contradictory configs (TMT market cap fence vs watchlist) | 4 |
| 6 | `Watchlist Searches` produces 31 signals/24h but zero tagged NVDA/AMD/MSFT | 1 |
| 7 | `AnalystSignalRoute.status` never reaches `ACTED_ON` — 0 rows ever | 3 |
| 8 | 60% run failure rate, un-instrumented | 4 |
| 9 | No signal→thesis→outcome traceability (`Thesis.sourceSignalIds`, `Monitor.successScore` don't exist) | 3 |
| 10 | `ResearchRun.parameters.toolStats` null on every row | 4 |
| 11 | No `/intelligence/health` dashboard surface | 4 |
| 12 | Brief doesn't surface real discovery tickers (only recycles watchlist names) | 2 |

Not covered: firm-level "find new tickers matching theme" discovery monitor queries. Deferred to a later session once these 4 ship.

## Already fixed (separate work)

- Morning cron restored — domain monitors now firing.
- FMP + Finnhub ingest re-enabled — data flowing, routing handled separately.

## Wave 1 — parallel (fire both now)

### Session 1 — Routing/Scoring (ongoing in this branch)
Files: `lib/inngest/functions/signal-router.ts`, `lib/intelligence/signals.ts`, `lib/inngest/functions/portfolio-watchlist-monitor.ts`.
Scope: issues #1, #2, #6.

### Session 2 — Brief Generator Rewrite
Brief: `docs/SESSION-2-BRIEF-GENERATOR.md`.
Files: `lib/inngest/functions/morning-brief-generator.ts` only.
Scope: issues #3, #4, #12.
Safe to run parallel with Session 1 (zero file overlap).

## Wave 2 — parallel (fire both after Wave 1 merges)

### Session 3 — Signal→Thesis→Monitor Traceability
Brief: `docs/SESSION-3-TRACEABILITY.md`.
Files: `prisma/schema.prisma` + migration, `lib/agent/tools/record-thesis.ts`, `lib/agent/tools/read-signals.ts`, `lib/inngest/functions/trade-evaluator.ts`, small patch to `lib/agent/system-prompt.ts`.
Scope: issues #7, #9.

### Session 4 — Observability + Config Guard + Failure Triage
Brief: `docs/SESSION-4-OBSERVABILITY.md`.
Files: `app/api/agent/[mode]/route.ts`, `app/(root)/intelligence/health/page.tsx`, `components/intelligence/*`, `lib/agent/tools/suggest-config.ts`, `scripts/audit-analyst-configs.ts`.
Scope: issues #5, #8, #10, #11.
Safe to run parallel with Session 3 (zero file overlap; Monitor ROI panel defensive-reads Session 3's fields).

## Orchestration rules

1. Each session runs on a fresh branch off `main`, opens its own PR.
2. A session touches ONLY the files listed in its brief. If work leaks into another session's files, STOP and ask.
3. Every session starts by running its brief's "Verify baseline" SQL against the Hindsight Supabase project (id: `zomxxtqiszpkqrjrqqat`) to confirm the bug still exists. Data decays fast.
4. Every session ends by running "Verify success" SQL + a manual sanity check.
5. Out-of-scope items in each brief are intentional. Defer or ask — do not bundle.

## Reference prompts

To kick off Session 2 in a fresh Claude Code session:

> Read `docs/SESSION-2-BRIEF-GENERATOR.md` in full, then execute. Another session is editing `signal-router.ts` in parallel — do not touch that file. Run "Verify baseline" first, implement, run "Verify success", commit.

To kick off Session 3:

> Read `docs/SESSION-3-TRACEABILITY.md` in full, then execute. Session 4 is running in parallel on dashboards/config — do not touch `app/api/agent/[mode]/route.ts`, `/intelligence` pages, `suggest-config.ts`, or `scripts/`. Run baseline + implement + verify end-to-end (open + close a test position) + commit.

To kick off Session 4:

> Read `docs/SESSION-4-OBSERVABILITY.md` in full, then execute. Session 3 is adding `Thesis.sourceSignalIds` + `Monitor.successScore` in parallel — defensive-read those fields with optional chaining. Do not touch `prisma/schema.prisma`, `record-thesis.ts`, `read-signals.ts`, or `trade-evaluator.ts`. Run baseline + implement + verify + commit.

If Fix 4 (failure triage) uncovers a cross-file pattern, Session 4 must stop and ask before expanding.
