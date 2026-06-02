# Daily Run Review — Session Prompt

You are reviewing the morning research runs for Hindsight. Your job is to produce a
structured run review that can serve as the baseline for the next review session.

## Scrutiny level — READ FIRST

**Live analysts** (`AgentConfig.tradingEnvironment = "LIVE"`, or any thesis with
`promotedAt` set) get the full rubric. **Real money is at risk.** Apply the
PROMOTED-specific checks ([Section B](#b-promoted-specific-checks)) before
anything else, then dispatch checks ([Section C](#c-dispatch-behavior-check)),
then resolver-adherence checks ([Section G](#g-resolver-actionability-adherence)).
Verb the agent's reasoning out loud: if the run touched a PROMOTED thesis, the
rationale **must** cite paper context (tenure / paper P&L / review count) by name.

**Paper analysts: full rubric through 2026-06-15.** Conviction Expression (PR #360) +
Discovery overhaul (PR #361) just landed. Paper output is the primary signal for
whether those changes are working. After 2026-06-15, revert to the prior policy
(paper = Section F unless A–E is conspicuously wrong) unless a new shakeout is in
flight.

## Before you start

Read these in order:

1. [`docs/GAPS.md`](../GAPS.md) — **start at the "Done since" section** to catch up
   on system changes since the last review. The rubric below assumes the current
   state of the system; if you're reviewing runs from before a "Done since" entry,
   apply the old rules for that day and note the transition. Then read the open
   P0/P1 list to flag anything that appears (or fails to appear) in today's data.
2. [`docs/run-reviews/TEMPLATE.md`](../run-reviews/TEMPLATE.md) — the report shape and all required sections
3. The most recent `docs/run-reviews/YYYY-MM-DD.md` — your prior baseline for delta columns
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
6. **Horizon-aware staleness on `researchUpdatedAt`** ([PR #352](https://github.com/dave-sucks/hindsight/pull/352) removed the hard `place_trade` staleness gate):
   - Horizon thresholds (`STALE_DAYS_BY_HORIZON` in [lib/agent/thesis-research/staleness.ts](../../lib/agent/thesis-research/staleness.ts)): CATALYST/TRADE 7d, TARGET 30d, COMPOUNDER 90d.
   - There is **no** Layer-1 gate at `place_trade` for staleness anymore. Staleness is a soft input to the REVIEW flow.
   - Expected behavior: the daily-run agent, walking per-thesis at REVIEW time, dispatches `dispatch_thesis_research(mode='refresh')` for theses past their horizon threshold and either waits for the refresh (`wait_for_thesis_refresh`) or soft-patches via `update_thesis` if the staleness is borderline.
   - **Flag:** the agent acted (`place_trade`, `update_thesis(change_status=*)`, `manage_position`) on a thesis whose research was past horizon threshold AND no preceding `dispatch_thesis_research` for that thesis_id landed earlier in the run. That's a judgment failure under the new model.
7. **Writer-quality (per dispatched THESIS_WRITER child run today) — NEW for [PR #360](https://github.com/dave-sucks/hindsight/pull/360):**
   - **`conviction` set?** STRONG / HIGH / MEDIUM / LOW. Required for LONG/SHORT theses. NULL on a directional thesis written today = writer regression.
   - **`variantView` present for STRONG / HIGH?** Layer-1 gate requires it (`record_thesis` + `update_thesis`). Quote it if vapor (e.g., "consensus is wrong about valuation" with no specific number) — gate caught field-presence, not substance.
   - **`convictionRationale` is judgment, not math restatement** ([P1-11](../GAPS.md)). Read the string. "I really like this setup, June 3 is the catalyst, here's why I trust the print…" is the target shape. "Composite 7/10, R/R 2.5:1, post-print drift looks strong" is math-rationale regression — flag with ticker + verbatim quote. If >2 in a single review read like math-restatement, the prompt isn't holding and we go to the `wouldBuyWithOwnMoney` fallback.
   - **`targetSizePct` set on directional theses?** Required after #360. NULL = writer regression.
   - **Sonar date sanity** ([P1-5 MRVL hallucination](../GAPS.md)): does any of {`recentCatalysts`, `latestEarnings`, `catalystsAndEvents`, `convictionRationale`, `coreBelief`} claim a catalyst PRINTED (beat / missed / raised guide) when the next earnings date is in the future? That's the writer hallucinating analyst estimates as actuals. Cross-check against the run's `catalystDate` column and against Finnhub's earnings calendar for ground truth.
   - **`backfilled from composite on 2026-05-31` rationale**: theses with this string are V4 backfill, not writer-attested. Don't grade them on rationale quality; do flag if the agent acted on a backfilled thesis without a refresh dispatch (the backfilled rationale is a placeholder, not the writer's view).

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

The dispatch architecture ([lib/agent/tools/dispatch-thesis-research.ts](../../lib/agent/tools/dispatch-thesis-research.ts), Phase 1 = PR #282). `dispatch_thesis_research` is in the daily-run + tactical + discovery + principal allowlists ([lib/agent/modes.ts](../../lib/agent/modes.ts)). `wait_for_thesis_refresh` is the blocking counterpart.

**Cross-analyst dedup** ([PR #361](https://github.com/dave-sucks/hindsight/pull/361)): `dispatch_thesis_research` now refuses a dispatch if another analyst dispatched the same ticker within a recent window. Recovery shape: the second caller gets a refusal envelope and should read the existing/in-flight writer output instead of re-dispatching.

For each MORNING_PLAN run:

1. **List every `dispatch_thesis_research` call.** Pull from `RunMessage` regex or `parameters.toolStats.byTool.dispatch_thesis_research`. For each: ticker, mode (`mint` / `refresh`), reason field.
2. **Did the child run complete?** Each dispatch creates a child `ResearchRun(mode='THESIS_WRITER', parentRunId=<parent>)`. Walk to `/runs/<parentId>` or query directly: `WHERE parentRunId = X AND mode='THESIS_WRITER'`. Report `status` + `elapsed_s`. Failed children burn budget and may have blocked the parent.
3. **Judgment-driven refresh dispatch** ([PR #352](https://github.com/dave-sucks/hindsight/pull/352) removed the `place_trade` staleness gate). The agent decides during REVIEW whether to dispatch. Expected shape:
   - For each ACTIVE / WATCHING / PROMOTED thesis at run start, check `Thesis.researchUpdatedAt` against the horizon's `STALE_DAYS_BY_HORIZON` threshold.
   - If past threshold, the agent's REVIEW-step rationale should either (a) cite a `dispatch_thesis_research(mode='refresh')` call in the run, then `wait_for_thesis_refresh`, then act on fresh research, OR (b) explicitly document why a soft-patch via `update_thesis` is sufficient.
   - **Old gate-recovery flow is gone.** Don't look for `place_trade` returning `data.note='research is missing' / 'days stale'` anymore — that gate was deleted. The new failure mode is "agent acted on stale research without dispatching a refresh" — see Section A6.
4. **Acted on stale research without dispatching?** Cross-check: for every `update_thesis` / `place_trade` / `close_position` / `manage_position` call today, look up `Thesis.researchUpdatedAt` at the time. If past horizon threshold (Section A6) AND no preceding `dispatch_thesis_research(refresh)` for that thesis in this run, flag it. Higher bar on LIVE-analyst PROMOTED rows than on PAPER WATCHING rows.
5. **Cross-analyst dedup landed cleanly?** If two analysts ran near-simultaneously and both touched the same ticker, the second `dispatch_thesis_research` should have been refused. If both dispatches went through and produced two THESIS_WRITER child runs for the same ticker on the same day, the dedup didn't fire — note ticker + both parent run IDs.
6. **THESIS_WRITER fail-mode:** the parent should NOT hang if the child fails. PR #287 wrapped THESIS_WRITER in try/catch and PRINCIPAL_CHAT's path was filed as P1-19. If a parent run is `status=RUNNING` for >15min with a `FAILED` child dispatch, that's the P1-19 shape — note it. **Also check for the 2026-05-31 Secular Compounder 5/5 FAILUREs pattern** ([P1-12](../GAPS.md)): if ALL writer dispatches in a single analyst's run failed with similar provider errors (rate limit / context-too-long), that's the token-exhaustion shape, not a code bug.

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

Carried over from the pre-2026-05-26 rubric. The newer checks (A–E + G) layer on top.

- Tool call counts vs expected for the analyst's archetype
- Run duration vs budget (research-run = 800s ceiling, abort at 770s — [lib/agent/modes.ts:177](../../lib/agent/modes.ts))
- `complete_run` called cleanly? Any preflight refusals?
- `record_run_summary` populated with the 5 buckets correctly?
- Narration→execution gap on any `close_position` calls? P0-12 lives at `complete_run` preflight now ([lib/agent/tools/complete-run.ts:362-375](../../lib/agent/tools/complete-run.ts), `checkNarrationExecutionGap`). If the gate fired, the run logs will show a `RunEvent(type='run_failed', title='Narration without tool call ...')`.
- Premature-exit retry path: did `morning-research.ts` re-fire on a `prematureExitViolation` or `coverageMissing` shape?
- Overdue-review backlog trend (>7d, any-overdue) vs prior
- **`read_signals` calls = 0** ([PR #361](https://github.com/dave-sucks/hindsight/pull/361) stripped the tool from the daily-run allowlist). Any `read_signals` call in `parameters.toolStats.byTool` is either an allowlist regression or a stale-prompt regression — both are bugs.

### G. Resolver actionability adherence ([PR #360](https://github.com/dave-sucks/hindsight/pull/360))

`get_theses` returns a computed `resolved` envelope per row: `currentPrice`,
`triggerState`, `actionability` (`READY_TO_BUY` / `WAITING_FOR_TRIGGER` /
`CATALYST_PENDING` / `HOLDING` / `SUPERSEDED` / …), `supersededBy`.
The agent is taught to filter by `actionability` first, then modulate by
`conviction`. This check asks: did it?

For each thesis the run touched:

1. **Reconstruct `resolved.actionability` at run start.** Re-run the resolver
   (or query `Thesis` + Finnhub quote at `ResearchRun.startedAt`) for each
   ACTIVE / WATCHING / PROMOTED thesis the run touched. Note the verdict.
2. **`READY_TO_BUY` → trade or documented refusal.** If actionability was
   `READY_TO_BUY` at run start (price ≥ entry trigger, no blocking gate) and
   the agent didn't `place_trade`, the `update_thesis.rationale` or
   `record_run_summary.decision_rationale` must explicitly explain why. "Wait
   for CPI" / "size too small for live book" / "conviction downgraded
   mid-run" are all acceptable. Silence is not.
3. **`WAITING_FOR_TRIGGER` → no trade, REVIEW-only update is fine.** The
   agent's update should be `update_thesis(type='REVIEWED')` with light
   evidence diff, not a heavyweight rewrite.
4. **`CATALYST_PENDING` → no trade until catalyst clears.** A trade on a
   `CATALYST_PENDING` thesis is a PEAD-discipline violation (the whole point
   of the catalyst-pending state). Flag.
5. **`SUPERSEDED` → don't act.** A `SUPERSEDED` thesis is overruled by a
   newer same-ticker thesis. If the agent acted on the superseded row, that's
   either a resolver bug or the agent reading the wrong row. Cross-check
   `supersededBy` and the actual chosen thesis ID.
6. **Conviction modulation:** STRONG / HIGH should be acted on at full
   `targetSizePct` when actionability is `READY_TO_BUY`. LOW should be
   skip-by-default — if the agent traded a LOW conviction thesis, the
   rationale needs to justify the override. List ticker + conviction +
   actual size vs `targetSizePct`.
7. **Cross-analyst supersession bug regression** ([PR #360](https://github.com/dave-sucks/hindsight/pull/360)
   fixed it): a `SUPERSEDED` verdict caused by a PASS thesis on a different
   analyst's book is a regression. Query: `Thesis WHERE supersededBy IS NOT NULL`
   and confirm the superseding thesis shares `agentConfigId` with the
   superseded one. Cross-analyst supersession = bug.

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

-- Conviction coverage on theses touched today (PR #360 quality check)
WITH touched AS (
  SELECT DISTINCT tu."thesisId" FROM "ThesisUpdate" tu
  JOIN "ResearchRun" r ON r.id = tu."runId"
  WHERE r.mode IN ('MORNING_PLAN', 'INTRADAY_TACTICAL', 'THESIS_WRITER')
    AND (r."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
)
SELECT t.ticker, t.status, t.direction,
       t.conviction,
       (t."convictionRationale" IS NOT NULL) AS has_rationale,
       LENGTH(t."convictionRationale") AS rationale_len,
       LEFT(t."convictionRationale", 120) AS rationale_preview,
       (t."convictionRationale" = 'backfilled from composite on 2026-05-31') AS is_backfilled,
       (t."variantView" IS NOT NULL) AS has_variant_view,
       LEFT(t."variantView", 120) AS variant_preview,
       t."targetSizePct"
FROM "Thesis" t
WHERE t.id IN (SELECT "thesisId" FROM touched)
  AND t.direction IN ('LONG', 'SHORT');
-- Expectations:
--   conviction NOT NULL on every row.
--   has_variant_view = TRUE when conviction IN ('STRONG', 'HIGH').
--   is_backfilled = TRUE → don't grade quality; flag if agent acted on this row.
--   rationale_preview: read it. Math restatement ("Composite 7/10, R/R 2.5:1") = P1-11 regression.

-- Conviction distribution across all open theses
SELECT conviction,
       COUNT(*) AS n,
       COUNT(*) FILTER (WHERE status = 'ACTIVE') AS n_active,
       COUNT(*) FILTER (WHERE status = 'WATCHING') AS n_watching,
       COUNT(*) FILTER (WHERE status = 'PROMOTED') AS n_promoted
FROM "Thesis"
WHERE direction IN ('LONG', 'SHORT')
  AND status IN ('ACTIVE', 'WATCHING', 'PROMOTED')
GROUP BY conviction
ORDER BY CASE conviction
  WHEN 'STRONG' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END;

-- Sonar date-sanity sniff (P1-5 MRVL-class hallucination)
-- Flags rows where a "printed" / "beat" / "missed" claim appears in research text
-- but the catalystDate (or next earnings date) is in the future.
SELECT t.ticker, t.status, t."catalystDate",
       (t."catalystDate" > NOW()) AS catalyst_in_future,
       LEFT(t."recentCatalysts"::text, 200) AS recent_catalysts_preview,
       LEFT(t."convictionRationale", 200) AS rationale_preview
FROM "Thesis" t
WHERE (t."researchUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
  AND (
    t."recentCatalysts"::text ~* '(printed|beat|missed|raised guide|posted)'
    OR t."convictionRationale" ~* '(printed|beat|missed|raised guide|posted)'
    OR t."coreBelief" ~* '(printed|beat|missed|raised guide|posted)'
  )
  AND t."catalystDate" > NOW();
-- Any returned row warrants manual inspection: writer may be hallucinating
-- analyst estimates as actuals.

-- Cross-analyst dispatch dedup check (PR #361)
-- If two analysts dispatched the same ticker on the same day, the second should
-- have been refused.
SELECT child.parameters->>'ticker' AS ticker,
       COUNT(DISTINCT child."agentConfigId") AS analyst_count,
       array_agg(DISTINCT child.id ORDER BY child.id) AS child_run_ids,
       array_agg(DISTINCT ac.name) AS analysts
FROM "ResearchRun" child
LEFT JOIN "AgentConfig" ac ON ac.id = child."agentConfigId"
WHERE child.mode = 'THESIS_WRITER'
  AND (child."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date = DATE '<TODAY>'
GROUP BY ticker
HAVING COUNT(DISTINCT child."agentConfigId") > 1;
-- Any returned row = dedup didn't fire. Note ticker + both parent IDs.

-- Resolver-shadow: actionability the agent SHOULD have seen at run start
-- (manual: re-run resolver against price snapshot at startedAt; flag where the
-- agent's action diverged from the actionability verdict — see Section G.)
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
