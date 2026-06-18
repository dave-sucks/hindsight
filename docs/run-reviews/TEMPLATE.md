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
| Overdue-review backlog (>7d, HOLDING+WATCHING+PROMOTED) | | | |
| Overdue-review backlog (any, HOLDING+WATCHING+PROMOTED) | | | |

\* `read_signals` was stripped from the daily-run allowlist in PR #361. Expected = 0. Anything else is a regression.

### Conviction tier distribution (PR #360)

| Tier | Total | HOLDING | WATCHING | PROMOTED | Δ vs prior |
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
| ENTER_NOW | | | |
| WAIT_FOR_TRIGGER | | | |
| PENDING_CATALYST | | | |
| STALE_PAST_CATALYST | | | |
| ACTIVE_HOLD | | | |
| SUPERSEDED | | | (any cross-analyst SUPERSEDED → bug, see Section G item 7) |
| PROMOTED_DECIDE_TODAY | | | |
| DEAD | | | (PASSED / RETIRED — terminal; should never be acted on) |

### Proposal-flow integrity (PR #364 — applies when any analyst had toggle ON)

| Metric | Today | Prior | Delta |
|--------|-------|-------|-------|
| Analysts with `requireApprovalForBuys/Sells = true` at run start | | | |
| `place_trade` calls on toggle-ON analysts | | | |
| `close_position` calls on toggle-ON analysts | | | |
| `manage_position(add_to_position)` calls on toggle-ON analysts | | | |
| `manage_position(full_close)` calls on toggle-ON analysts | | | |
| New `Order(status='AWAITING_APPROVAL')` rows created today | | | |
| New `Position(status='PENDING_APPROVAL')` rows created today | | | |
| `PROPOSAL_APPROVED` audit rows (Approve clicks today) | | | |
| `PROPOSAL_REJECTED` audit rows (Reject clicks today) | | | |
| `PROPOSAL_EXPIRED` audit rows (cron-generated) | | | |
| Orphan `PENDING` Orders (`alpacaOrderId IS NULL`) — Section H item 6 * | | | |
| Duplicate `PROPOSAL_APPROVED` rows per orderId — Section H item 7 * | | | |
| Ungated paths that went through proposal (`price_monitor` / `user`) — Section H item 4 * | | | |
| Tool-envelope vs narration gap (agent narrated fill, actually awaiting) — Section H item 3 * | | | |
| Proposal-expiry cron firings during market hours (~30 / day expected) | | | |

\* Expected = 0. Any non-zero is a finding.

## Behavior

Per-analyst walkthrough. For each analyst that ran today:

- **Run ID + status + elapsed + total tool calls**
- **Key flow events:** Phase 0 portfolio check-in, per-thesis REVIEW walk, dispatch decisions, trade decisions, run-summary buckets
- **Section A:** thesis-quality check on every thesis touched (including new writer-quality items — conviction, variantView, rationale substance, Sonar date sanity)
- **Section B (LIVE / PROMOTED only):** PROMOTED-specific checks
- **Section C:** dispatch behavior — list every `dispatch_thesis_research` call with child status + elapsed
- **Section D:** "moved but wasn't traded" — any thesis whose price action warranted an action the agent didn't take
- **Section E:** trigger sanity (`nextReviewAt`, ENTER-on-HOLDING / missing-EXIT, etc.)
- **Section F:** standard checks (tool counts, duration, complete_run, narration→execution, premature-exit retry, **`read_signals` calls = 0**)
- **Section G:** resolver actionability adherence — for each touched thesis, what `resolved.actionability` was at run start vs what the agent did
- **Section H (toggle-ON analysts only):** proposal-flow integrity — gate fired, audit trail, ungated paths still ungated, no orphans / dupes

Flag ✓/✗ for each expected behavior.

## Failures

| Run | Mode | Category | Root cause from `parameters.error` / events |
|-----|------|----------|----------------------------------------------|
| | | | |

Categories: `Code/runtime — silent timeout`, `Code/runtime — exception`, `Quality gate — narration→execution`, `Quality gate — promotion`, `Quality gate — complete_run preflight`, `Writer — Sonar hallucination (P1-5)`, `Writer — provider error / token exhaustion (P1-12 shape)`, `Writer — math-rationale regression (P1-11)`, `Proposal — gate bypass`, `Proposal — over-gate (ungated path went through proposal)`, `Proposal — orphan PENDING order`, `Proposal — duplicate approval / race`, `Proposal — tool envelope vs narration gap`.

## New Findings

Observations not present in prior run reviews. Include: new failure patterns, unexpected tool call sequences, gate behavior worth noting, data anomalies. Label findings by rubric letter (A–H) so they're greppable across reviews.

## Trends vs Prior Report

Directional commentary on the metrics delta. E.g. "Overdue-review backlog draining: 19→13 (>7d)." "Conviction-NULL count: 12→3 — backfill working." Note if a prior Open Question is now answered.

## Open Questions

Numbered list of things to investigate before the next review. Each should be answerable by SQL query, log inspection, or code read — not speculation.

## Raw Queries

> See [`docs/prompts/REVIEW_DAILY_RUN.md` → Canonical SQL](../prompts/REVIEW_DAILY_RUN.md#canonical-sql--top-of-every-review) for the full SQL block. Paste outputs (or notable subsets) here for the day's record.
