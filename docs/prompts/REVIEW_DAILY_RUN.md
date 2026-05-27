# Daily Run Review — Session Prompt

You are reviewing the morning research runs for Hindsight. Your job is to produce a
structured run review that can serve as the baseline for the next review session.

## Live-analyst extra scrutiny — READ FIRST

If the analyst being reviewed has `AgentConfig.tradingEnvironment = "LIVE"`, **or** any
thesis being reviewed has `promotedAt` set (i.e. it was carried across the PAPER→LIVE
promotion), the analyst is post-promotion and **real money is at risk**. Apply the
PROMOTED-specific checks ([Section B](#b-promoted-specific-checks) below) before
anything else, and the staleness/dispatch checks ([Section C](#c-dispatch-behavior-check))
right after — those are the layers that have to hold tight on a live book. Verb the
agent's reasoning out loud: if the run touched a PROMOTED thesis, the rationale **must**
cite paper context (tenure / paper P&L / review count) by name.

A LIVE analyst gets the full rubric below; PAPER analysts can be reviewed at the
"Section F (standard)" level unless something in A–E is conspicuously wrong.

## Before you start

Read these in order:

1. [`docs/run-reviews/TEMPLATE.md`](../run-reviews/TEMPLATE.md) — the report shape and all required sections
2. The most recent `docs/run-reviews/YYYY-MM-DD.md` — your prior baseline for delta columns
3. [`docs/GAPS.md`](../GAPS.md) — known open issues; flag any that appear (or fail to appear) in today's data
4. [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — the live state-machine reference. Confirm any PROMOTED / dispatch behavior you're about to claim matches §3 (states) + §11 (run-summary derivation)

## What to query (default)

Run all SQL blocks from the template's "Raw Queries" section, substituting today's date.
On top of those, look at:

- `parameters.toolStats.byTool` in `ResearchRun.parameters` for every MORNING_PLAN run — confirm `dispatch_thesis_research` + `wait_for_thesis_refresh` counts when freshness gates fire
- `RunEvent` rows for the failed runs (to distinguish quality-gate failures from runtime failures); the narration→execution gate writes `type='run_failed'` with `title` starting `Narration without tool call`
- `parameters.error` and `parameters.toolStats.totalToolCalls` for silent failures
- The overdue-review backlog query (trend over time)
- Child runs spawned today: `WHERE mode='THESIS_WRITER' AND createdAt >= today_et_midnight`. Walk each — parent runId, ticker, mode (`mint` / `refresh`), child status, elapsed
- Tactical runs spawned today: `WHERE mode='INTRADAY_TACTICAL' AND createdAt >= today_et_midnight`. Cross-reference each against `thesisId` and the triggering thesis's `status` — see Section B orphan check

## Evergreen checks — apply every morning

The checks below are not one-offs; they fire on every review session regardless of
the day. Lifted into the rubric on 2026-05-26 alongside the first PAPER→LIVE
promotion. Sections A–F are tagged in the report's New Findings / V2 Behavior tables
so future reviews can grep for "Section B / C orphan" etc.

### A. Thesis quality check (per thesis touched in the run)

The 9 deep-research sections live as first-class columns on `Thesis` (PR-9 flat
schema, [prisma/schema.prisma:272-295](../../prisma/schema.prisma)):

| Section | Column |
|---|---|
| Snapshot | `snapshot` |
| Recent catalysts | `recentCatalysts` |
| Fundamentals | `fundamentals` |
| Latest earnings | `latestEarnings` |
| Catalysts & events | `catalystsAndEvents` |
| Bull case | `bullCase` |
| Bear case | `bearCase` |
| Analyst consensus | `analystConsensus` |
| Insider / technical | `insiderTechnical` |

For each thesis the run touched (look at `ThesisUpdate WHERE runId = X` joined to
`Thesis`):

1. **All 9 populated?** A thesis that's been through the thesis-writer (`researchUpdatedAt IS NOT NULL`) should have all 9 non-null. Pre-V2 legacy seeds may have only `snapshot / bullCase / bearCase`; flag those as "legacy — refresh candidate" but don't grade them as a quality failure. PASS theses commonly only populate `snapshot + bearCase` (per schema doc) — that's expected.
2. **`bullCase.bullets[]` substantive?** Specific numbers / dates / named events. Generic strings ("strong fundamentals", "good momentum", "positive sentiment") fail this check.
3. **`bearCase.bullets[]` substantive AND adversarial?** A LONG thesis with a vapor bear case ("market correction", "macro risk") is a quality failure even if the run is otherwise clean. Quote the bear bullets in the review when they're vapor.
4. **`coreBelief` still holds?** Read the run's `update_thesis` rationale — did the agent re-evaluate the belief against today's price + news, or skip it? If price has moved >10% or a named catalyst landed since `researchUpdatedAt`, expect either a belief-edit or a refresh dispatch. If neither happened, flag it.
5. **`keyAssumptions` falsifiable?** Each entry should be checkable. "Company will keep growing" is not. "US commercial revenue ≥40% YoY through Q4 2026" is. List unfalsifiable assumptions by ticker.
6. **`researchUpdatedAt` staleness:**
   - >7 days old: the daily run should consider dispatching a refresh. Flag if it didn't AND the agent acted on the thesis (traded, invalidated, scaled).
   - >14 days old (`STALE_DAYS`, [lib/agent/thesis-research/staleness.ts](../../lib/agent/thesis-research/staleness.ts)): `place_trade` refuses on WATCHING / PROMOTED without a refresh. If a trade happened anyway, that's a Layer-1 gate violation worth verifying. If the agent narrated a trade and got refused, flag the recovery shape (did it dispatch?).

### B. PROMOTED-specific checks

The PROMOTED state ([prisma/schema.prisma:186](../../prisma/schema.prisma), enum
value of `ThesisStatus`) is set only at PAPER→LIVE promotion. Detect a PROMOTED
thesis via `Thesis.status = 'PROMOTED'`. The promotion context lives in four columns:
`promotedAt`, `paperTenureDays`, `paperRealizedPnl`, `paperReviewCount`
([prisma/schema.prisma:316-319](../../prisma/schema.prisma)).

Apply per PROMOTED thesis on the live analyst's book today:

1. **Fan-out fired?** `researchUpdatedAt` should show a refresh **at or after** `promotedAt`. The promotion action ([lib/actions/promote-analyst.actions.ts](../../lib/actions/promote-analyst.actions.ts)) fans out a `dispatch_thesis_research(mode='refresh')` for every ACTIVE thesis it carries forward to PROMOTED — if `researchUpdatedAt < promotedAt`, the fan-out didn't reach that row. Bug or stale config.
2. **Paper-context columns populated?** Cross-check `paperTenureDays / paperRealizedPnl / paperReviewCount` against `Position` history pre-promotion + `ThesisUpdate WHERE type IN ('REVIEWED','UPDATED') AND thesisId = X` count pre-promotion. Mismatch = the snapshot at promotion-time was off.
3. **Agent cited paper context in narration?** Read the run's `update_thesis` rationale + `record_run_summary` text for the PROMOTED ticker. Did the agent explicitly weigh paper tenure / paper P&L / review count in the re-enter / downgrade / invalidate decision? "PROMOTED, $X paper P&L over N days, M reviews → re-enter at $..." is the shape we expect. Generic "this looks good" is not.
4. **PROMOTED → ACTIVE flip clean?** If any PROMOTED thesis flipped to ACTIVE via `place_trade` today: confirm the `ThesisUpdate(type='STATUS_CHANGED')` row exists with `tradeId` populated. The `place_trade` atomic flip ([lib/agent/tools/place-trade.ts](../../lib/agent/tools/place-trade.ts)) handles this — missing audit row is a bug.
5. **PROMOTED → WATCHING / INVALIDATED?** If downgraded: the rationale should cite either paper context ("paper return was −$X over N days, conviction was weaker than the tenure suggests") OR fresh evidence ("new SEC filing breaks the bull case"). Pure narration-rewrites without a concrete reason are a quality failure on a live book.
6. **Orphan tactical EXIT runs** ([ex-P1-21, closed via PR #333 PROMOTED-aware triggers](../GAPS.md)): a PROMOTED thesis carries no paired Position (paper position was force-closed at promotion). A tactical run spawned from a PROMOTED-thesis `PRICE_BELOW(stop)` trigger that tries to `close_position` will error out — there's no position to close. Count these. Pre-fix rows: search for `mode='INTRADAY_TACTICAL' AND parameters->>'predicateKind'='PRICE_BELOW' AND ResearchRun.status='FAILED'` with the failure cite naming `close_position`. Should be zero post-#333; flag any that surface.

### C. Dispatch behavior check

The dispatch architecture ([lib/agent/tools/dispatch-thesis-research.ts](../../lib/agent/tools/dispatch-thesis-research.ts), Phase 1 = PR #282, Phase 2 staleness gate = PR #332). `dispatch_thesis_research` is in the daily-run + tactical + discovery + principal allowlists ([lib/agent/modes.ts:165, 273, 357, 428](../../lib/agent/modes.ts)). `wait_for_thesis_refresh` is the blocking counterpart.

For each MORNING_PLAN run:

1. **List every `dispatch_thesis_research` call.** Pull from `RunMessage` regex or `parameters.toolStats.byTool.dispatch_thesis_research`. For each: ticker, mode (`mint` / `refresh`), reason field.
2. **Did the child run complete?** Each dispatch creates a child `ResearchRun(mode='THESIS_WRITER', parentRunId=<parent>)`. Walk to `/runs/<parentId>` or query directly: `WHERE parentRunId = X AND mode='THESIS_WRITER'`. Report `status` + `elapsed_s`. Failed children burn budget and may have blocked the parent.
3. **Staleness gate hit + recovered?** If `place_trade` returned `data.note` containing "research is missing" or "days stale" ([lib/agent/tools/place-trade.ts:184-235](../../lib/agent/tools/place-trade.ts), `Guardrail 0.5`), the agent should have: (a) dispatched a `mode='refresh'` for that thesis_id, (b) waited via `wait_for_thesis_refresh`, (c) retried `place_trade`. Walk the tool-call sequence and confirm. Half-recovery (dispatched but didn't retry) = soft failure to flag.
4. **Acted on stale research without dispatching?** Cross-check: for every `update_thesis` / `place_trade` / `close_position` call today, look up `Thesis.researchUpdatedAt` at the time. If >14 days old on a WATCHING or PROMOTED thesis AND no preceding `dispatch_thesis_research(refresh, existing_thesis_id=X)` landed for that thesis in this run, the Layer-1 gate would have refused — but it only fires on `place_trade`. `update_thesis` / `close_position` paths can still act on stale data. Flag those.
5. **THESIS_WRITER fail-mode:** the parent should NOT hang if the child fails. PR #287 wrapped THESIS_WRITER in try/catch and PRINCIPAL_CHAT's path was filed as P1-19. If a parent run is `status=RUNNING` for >15min with a `FAILED` child dispatch, that's the P1-19 shape — note it.

### D. The "moved but wasn't traded" check

For every thesis on the live analyst's book at run start (snapshot from `Thesis WHERE
agentConfigId = X AND status IN ('ACTIVE','WATCHING','PROMOTED')`):

1. **Pull today's price action** via `getStockQuote` or `Position.closePrice` at EOD, plus intraday high/low. Acceptable source: any Finnhub or Alpaca snapshot taken between run start and EOD.
2. **ACTIVE positions, price moved ≥3% intraday?** Confirm the thesis was reviewed in the run via `ThesisUpdate WHERE thesisId = X AND runId = <today's morning runId>`. No update row = the agent skipped a meaningful move. Flag.
3. **WATCHING / PROMOTED, price crossed `entryPrice` or any ENTER trigger level?** Confirm `place_trade` was called (or a tactical run was scheduled and converted). If neither: pull the agent's documented reason from `update_thesis.rationale` or `record_run_summary.decision_rationale`.
4. **Goalpost-moving check.** [GAPS MRVL reference](../GAPS.md) — a documented anti-pattern: agent raises the target on a WATCHING thesis when price is already at or above the OLD target instead of trading. Symptom: `update_thesis` with `target` edit, ticker price ≥ old target. Flag with ticker + old target + new target + price.
5. **Document the agent's reason VERBATIM** when a non-trade is questionable. "Agent didn't trade NVDA despite ENTER trigger conditions met at 14:23 ET (price $185.30 crossed entry $185.00). Stated reason: 'wait for tomorrow's CPI print before committing'" — quote it. The pattern matters more than any one instance.

### E. Trigger sanity check

1. **`nextReviewAt` past-dated or near-future weird value?** [PR #329's record-thesis Layer-1 validator](../../lib/agent/tools/record-thesis.ts) (line ~823, `MIN_FUTURE_HOURS = 6`) rejects agent-provided dates that resolve to the past or <6h out, falling back to the horizon default with a `console.warn`. Confirm by querying `Thesis WHERE createdAt::date = today AND nextReviewAt < createdAt + INTERVAL '6 hours'` — should be zero. Non-zero rows = the validator didn't fire or got bypassed.
2. **`REVIEW_DATE_HIT` triggers on rows whose `nextReviewAt` should be months out?** Possible data corruption from a past year-confusion bug. Query: `RunEvent WHERE type='trigger_fired' AND payload->>'predicateKind'='REVIEW_DATE_HIT' AND createdAt::date = today`, join to `Thesis`, look for `nextReviewAt` that's a year+ in the past or oddly clustered.
3. **Tactical runs that don't make sense given the trigger?** A tactical run spawned by `PRICE_ABOVE` on a SHORT thesis should be considering EXIT, not ENTER. Mismatches between `parameters.action` (`'ENTER'` / `'EXIT'`) and the thesis's `direction`/`status` are bugs ([PR #339 + #343 trigger correctness work](../../lib/agent/triggers/enter-guard.ts)).
4. **Symmetric ENTER-on-ACTIVE / missing-EXIT-on-ACTIVE rejections** ([PR #343 — shipped 2026-05-26 00:36 ET](../../lib/agent/triggers/enter-guard.ts)): an ACTIVE-side refresh should never produce an ENTER trigger or strip the EXIT trigger. If today's date is on or after 2026-05-26 and the agent did either, the guard didn't fire. Count `ThesisUpdate WHERE runId = <today> AND type='UPDATED'` rows whose resulting `Thesis.triggers` JSON shape has `ENTER` on an ACTIVE row OR is missing `EXIT` on an ACTIVE LONG/SHORT.

### F. Standard checks (cross-reference, keep applying)

Carried over from the pre-2026-05-26 rubric. The newer checks (A–E) layer on top.

- Tool call counts vs expected for the analyst's archetype
- Run duration vs budget (research-run = 800s ceiling, abort at 770s — [lib/agent/modes.ts:177](../../lib/agent/modes.ts))
- `complete_run` called cleanly? Any preflight refusals?
- `record_run_summary` populated with the 5 buckets correctly?
- Narration→execution gap on any `close_position` calls? P0-12 lives at `complete_run` preflight now ([lib/agent/tools/complete-run.ts:362-375](../../lib/agent/tools/complete-run.ts), `checkNarrationExecutionGap`). If the gate fired, the run logs will show a `RunEvent(type='run_failed', title='Narration without tool call ...')`.
- Premature-exit retry path: did `morning-research.ts` re-fire on a `prematureExitViolation` or `coverageMissing` shape?
- Overdue-review backlog trend (>7d, any-overdue) vs prior

## Canonical SQL — top of every review

Substitute today's ET date for `<TODAY>`. Most reviews will copy these into the
template's "Raw Queries" section verbatim.

```sql
-- Morning runs (one row per analyst)
SELECT r.id, ac.name AS analyst, ac."tradingEnvironment", r.status, r.environment,
       (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') AS started_et,
       EXTRACT(EPOCH FROM (COALESCE(r."completedAt", NOW()) - r."startedAt"))::int AS elapsed_s,
       r.parameters->>'error' AS error_text,
       r.parameters->'toolStats'->>'totalToolCalls' AS total_tool_calls,
       r.parameters->'toolStats'->'byTool'->>'dispatch_thesis_research' AS dispatch_calls,
       r.parameters->'toolStats'->'byTool'->>'wait_for_thesis_refresh' AS wait_calls,
       r.parameters->'toolStats'->'byTool'->>'place_trade' AS place_trade_calls,
       r.parameters->'toolStats'->'byTool'->>'close_position' AS close_position_calls
FROM "ResearchRun" r
LEFT JOIN "AgentConfig" ac ON ac.id = r."agentConfigId"
WHERE r.mode = 'MORNING_PLAN'
  AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
ORDER BY r."startedAt";

-- Thesis-writer child runs spawned today (any parent mode)
SELECT child.id AS child_run_id, parent.mode AS parent_mode, parent.id AS parent_run_id,
       ac.name AS analyst, child.parameters->>'ticker' AS ticker,
       child.parameters->>'mode' AS dispatch_mode, child.status,
       EXTRACT(EPOCH FROM (COALESCE(child."completedAt", NOW()) - child."startedAt"))::int AS elapsed_s,
       child.parameters->>'reason' AS reason
FROM "ResearchRun" child
LEFT JOIN "ResearchRun" parent ON parent.id = child."parentRunId"
LEFT JOIN "AgentConfig" ac ON ac.id = child."agentConfigId"
WHERE child.mode = 'THESIS_WRITER'
  AND (child."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
ORDER BY child."startedAt";

-- Tactical runs today (with predicate + action breakdown)
SELECT r.id, ac.name AS analyst, r.parameters->>'ticker' AS ticker,
       r.parameters->>'thesisId' AS thesis_id,
       r.parameters->>'predicateKind' AS predicate_kind,
       r.parameters->>'action' AS action, r.status, r.environment,
       EXTRACT(EPOCH FROM (COALESCE(r."completedAt", NOW()) - r."startedAt"))::int AS elapsed_s,
       r.parameters->>'error' AS error_text
FROM "ResearchRun" r
LEFT JOIN "AgentConfig" ac ON ac.id = r."agentConfigId"
WHERE r.mode = 'INTRADAY_TACTICAL'
  AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
ORDER BY r."startedAt";

-- PROMOTED theses on the book + their refresh + paper-context state
SELECT t.id, t.ticker, t.status, t.direction, ac.name AS analyst,
       t."promotedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' AS promoted_et,
       t."researchUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' AS research_updated_et,
       (t."researchUpdatedAt" >= t."promotedAt") AS refreshed_post_promotion,
       t."paperTenureDays", t."paperRealizedPnl", t."paperReviewCount",
       EXTRACT(DAY FROM (NOW() - t."researchUpdatedAt"))::int AS research_age_days
FROM "Thesis" t
LEFT JOIN "ResearchRun" rr ON rr.id = t."researchRunId"
LEFT JOIN "AgentConfig" ac ON ac.id = rr."agentConfigId"
WHERE t.status = 'PROMOTED'
   OR t."promotedAt" IS NOT NULL
ORDER BY t."promotedAt" DESC NULLS LAST;

-- The 9-section coverage check on theses touched today
WITH touched AS (
  SELECT DISTINCT tu."thesisId" FROM "ThesisUpdate" tu
  JOIN "ResearchRun" r ON r.id = tu."runId"
  WHERE r.mode IN ('MORNING_PLAN', 'INTRADAY_TACTICAL', 'THESIS_WRITER')
    AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
)
SELECT t.id, t.ticker, t.status, t.direction,
       (t.snapshot IS NOT NULL) AS s_snapshot,
       (t."recentCatalysts" IS NOT NULL) AS s_recent,
       (t.fundamentals IS NOT NULL) AS s_fund,
       (t."latestEarnings" IS NOT NULL) AS s_earn,
       (t."catalystsAndEvents" IS NOT NULL) AS s_cat,
       (t."bullCase" IS NOT NULL) AS s_bull,
       (t."bearCase" IS NOT NULL) AS s_bear,
       (t."analystConsensus" IS NOT NULL) AS s_consensus,
       (t."insiderTechnical" IS NOT NULL) AS s_insider,
       t."researchUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' AS research_updated_et
FROM "Thesis" t
WHERE t.id IN (SELECT "thesisId" FROM touched);

-- Past-dated / near-future nextReviewAt validation (PR #329 sanity)
SELECT t.id, t.ticker, t.status, t."createdAt", t."nextReviewAt",
       (t."nextReviewAt" - t."createdAt") AS interval_set
FROM "Thesis" t
WHERE (t."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
  AND t."nextReviewAt" IS NOT NULL
  AND t."nextReviewAt" < t."createdAt" + INTERVAL '6 hours';
-- Expect 0 rows. Any returned = validator missed or path bypassed.

-- Narration→execution gate fires + post-gate close attempts
SELECT "runId", type, title, LEFT(message, 300) AS msg,
       ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York') AS at_et
FROM "RunEvent"
WHERE ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
  AND (type = 'run_failed' OR title ILIKE '%narration%' OR title ILIKE '%no tool call%')
ORDER BY "runId", "createdAt";

-- Overdue-review backlog (trend metric)
SELECT
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING','PROMOTED')) AS active_or_watching,
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING','PROMOTED')
                   AND "nextReviewAt" < (NOW() - INTERVAL '7 days')) AS overdue_7d,
  COUNT(*) FILTER (WHERE status::text IN ('ACTIVE','WATCHING','PROMOTED')
                   AND "nextReviewAt" < NOW()) AS overdue_any
FROM "Thesis";
```

## What to produce

Write to `docs/run-reviews/<today's date>.md` using the template structure. For a
LIVE analyst, the report should have **sections labeled by rubric letter** (A–F) under
"New Findings" so the checks are auditable in the diff. The TL;DR for a LIVE-analyst
day should lead with:

- live analyst name + `tradingEnvironment` flip date
- total runs (daily + tactical + thesis-writer children)
- PROMOTED theses on the book + how they resolved today
- first live `place_trade` if it happened, or the reason none did
- any orphan tactical EXIT runs (Section B item 6)

Open one PR titled `docs(run-review): YYYY-MM-DD — first live <analyst-name>` (or the
appropriate phrasing for the date). The principal will skim → comment → merge.
