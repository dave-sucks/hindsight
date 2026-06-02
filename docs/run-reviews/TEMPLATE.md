# Run Review — YYYY-MM-DD

> Prior baseline: [YYYY-MM-DD](./YYYY-MM-DD.md). Delta columns compare against that report.

## TL;DR

1-2 paragraph summary of the day's runs. Lead with the failure count and any regressions vs prior. Note if a specific analyst or bug class dominated. For LIVE analysts, lead with the live analyst's outcomes (PROMOTED resolutions, first live trade if any).

## Daily Metrics

| Metric | Today | Prior | Delta |
|--------|-------|-------|-------|
| Morning runs (total / OK / fail) | | | |
| Tactical runs (total / OK / fail) | | | |
| Discovery runs (total / OK / fail) — chat-driven + Sunday cron | | | |
| THESIS_WRITER child runs (total / OK / fail) | | | |
| PRINCIPAL_CHAT runs with `dispatch_thesis_research > 1` (discovery chat sessions) | | | |
| Trades placed | | | |
| Positions closed | | | |
| Daily-run `dispatch_thesis_research` calls | | | |
| Daily-run `wait_for_thesis_refresh` calls | | | |
| Daily-run `place_trade` calls | | | |
| Daily-run `close_position` calls | | | |
| Daily-run `manage_position` calls | | | |
| Daily-run `update_thesis` calls | | | |
| Daily-run `record_thesis` calls | | | |
| Daily-run `get_stock_data` calls | | | |
| Daily-run `read_signals` calls * | | | |
| Cross-analyst dispatch dedup refusals | | | |
| Overdue-review backlog (>7d, ACTIVE+WATCHING+PROMOTED) | | | |
| Overdue-review backlog (any, ACTIVE+WATCHING+PROMOTED) | | | |

\* `read_signals` was stripped from the daily-run allowlist in PR #361. Expected = 0. Anything else is a regression.

### Conviction tier distribution (PR #360)

| Tier | Total | ACTIVE | WATCHING | PROMOTED | Δ vs prior |
|------|-------|--------|----------|----------|------------|
| STRONG | | | | | |
| HIGH | | | | | |
| MEDIUM | | | | | |
| LOW | | | | | |
| NULL (directional rows missing conviction — bug) | | | | | |
| Backfilled rationale (placeholder, not writer-attested) | | | | | |

### Resolver actionability distribution at run start

| Actionability | Count | Acted-on? | Notes |
|---------------|-------|-----------|-------|
| READY_TO_BUY | | | |
| WAITING_FOR_TRIGGER | | | |
| CATALYST_PENDING | | | |
| HOLDING | | | |
| SUPERSEDED | | | (any cross-analyst SUPERSEDED → bug, see Section G item 7) |
| PROMOTED_DECIDE_TODAY (once [P1-10](../GAPS.md) ships) | | | |

## Behavior

Per-analyst walkthrough. For each analyst that ran today:

- **Run ID + status + elapsed + total tool calls**
- **Key flow events:** Phase 0 portfolio check-in, per-thesis REVIEW walk, dispatch decisions, trade decisions, run-summary buckets
- **Section A:** thesis-quality check on every thesis touched (including new writer-quality items — conviction, variantView, rationale substance, Sonar date sanity)
- **Section B (LIVE / PROMOTED only):** PROMOTED-specific checks
- **Section C:** dispatch behavior — list every `dispatch_thesis_research` call with child status + elapsed
- **Section D:** "moved but wasn't traded" — any thesis whose price action warranted an action the agent didn't take
- **Section E:** trigger sanity (`nextReviewAt`, ENTER-on-ACTIVE / missing-EXIT, etc.)
- **Section F:** standard checks (tool counts, duration, complete_run, narration→execution, premature-exit retry, **`read_signals` calls = 0**)
- **Section G:** resolver actionability adherence — for each touched thesis, what `resolved.actionability` was at run start vs what the agent did

Flag ✓/✗ for each expected behavior.

## Failures

| Run | Mode | Category | Root cause from `parameters.error` / events |
|-----|------|----------|----------------------------------------------|
| | | | |

Categories: `Code/runtime — silent timeout`, `Code/runtime — exception`, `Quality gate — narration→execution`, `Quality gate — promotion`, `Quality gate — complete_run preflight`, `Writer — Sonar hallucination (P1-5)`, `Writer — provider error / token exhaustion (P1-12 shape)`, `Writer — math-rationale regression (P1-11)`.

## New Findings

Observations not present in prior run reviews. Include: new failure patterns, unexpected tool call sequences, gate behavior worth noting, data anomalies. Label findings by rubric letter (A–G) so they're greppable across reviews.

## Trends vs Prior Report

Directional commentary on the metrics delta. E.g. "Overdue-review backlog draining: 19→13 (>7d)." "Conviction-NULL count: 12→3 — backfill working." Note if a prior Open Question is now answered.

## Open Questions

Numbered list of things to investigate before the next review. Each should be answerable by SQL query, log inspection, or code read — not speculation.

## Raw Queries

> See [`docs/prompts/REVIEW_DAILY_RUN.md` → Canonical SQL](../prompts/REVIEW_DAILY_RUN.md#canonical-sql--top-of-every-review) for the full SQL block. Paste outputs (or notable subsets) here for the day's record.
