# Session Audit — 2026-05-06

Tracker for everything surfaced during the audit/review/fix session on 2026-05-06.
Status keys: ✅ fixed, 🟡 partially addressed, 🔴 open, ❌ withdrew.

## Context

Reviewed before/after of the architecture migration (PRs #193, #196, #198, #200,
#201, #202, #203, #205, #208, #209, #210). Compared OLD baseline (4/23–4/25, first
days with toolStats coverage) vs NEW (5/04–5/05) vs today (5/06). Then dug into
specific runs and the resulting state of the system.

Validation query (Supabase project `zomxxtqiszpkqrjrqqat`) day-over-day:

| | OLD (pre-rewrite) | NEW (post-4/30) | Today (5/06) |
|---|---|---|---|
| Decisions: HOLD | 9/run avg | 1.8/run | 7 total |
| Decisions: INITIATE | 0.33 | 0.00 | **1 (SMCI)** |
| `place_trade` calls | 0.33 | 0.00 | **1** |
| `manage_position` calls | 0.50 | 0.00 | 0 |
| `manage_watchlist` calls | 0.67 | 0.00 | 0 |
| `record_thesis` mints | 4.67 | 0.00 | 1 (SMCI) |
| `update_thesis` calls | 0.00 | 3.10 | ~2.5 |

The architecture rewrite succeeded at killing the daily re-mint pattern but the
action layer (`place_trade`, `manage_position`, `manage_watchlist`) remains
~80% atrophied. Today's SMCI trade was the first end-to-end successful path
since the rewrite — discovery → `record_thesis` (with triggers + horizon) →
`place_trade`. That is the architecture working as designed.

## Fixed this session

### Code changes

| # | Issue | Where |
|---|---|---|
| 1 | HOLD-on-watch decision label — agent classified non-held thesis edits as HOLD; persistence collapsed everything to `decision: HOLD`; WATCH actions silently dropped | `lib/agent/tools/record-run-summary.ts` — clarified `action` enum description, added pre-pass that downgrades misclassified HOLD→WATCH using a single batched position lookup, started persisting WATCH actions as TradeDecision rows |

### Data fixes (SQL via Supabase)

| # | Issue | Result |
|---|---|---|
| 2 | 23 LONG watchlist theses missing triggers + horizon | Backfilled `horizon='TARGET'`, `nextReviewAt=NOW()+1d`, and 5 baseline triggers (PRICE_BELOW stop → EXIT, PRICE_ABOVE target → REVIEW, EARNINGS_BEAT/MISS → REVIEW, TIME_ELAPSED 30d → REVIEW) |
| 3 | 94 orphan ghost theses (not held, not on watchlist) | `status='CLOSED'`, `closedAt=NOW()`, `closeReason='orphan-cleanup-2026-05-06'` |
| 4 | 102 mislabeled ACTIVE-on-watchlist | Relabeled to `WATCHING` |
| 5 | 1 inverted (CVX `WATCHING` but actually held) | Set to `ACTIVE` |
| 6 | 84 duplicate thesis rows per (analyst, ticker) | Marked older rows `SUPERSEDED`; kept latest per pair |

**Net effect:** Total open theses 251 → **65** (-74%).
Each analyst now has exactly 1 thesis per held position + 1 per visible watchlist item:

| Analyst | Open theses | Held | Watching | With triggers |
|---|---|---|---|---|
| Catalyst Event Raider | 11 | 1 | 10 | 7 |
| Earnings Drift Trader | 11 | 1 | 10 | 10 |
| EV Catalyst Event Trader | 10 | 2 | 8 | 8 |
| Global Event-Driven ETF Strategist | 14 | 1 | 13 | 14 |
| Secular Theme Architect | 12 | 1 | 11 | 9 |
| Tech Momentum Trader | 7 | 1 | 6 | 6 |

### Confirmed fixed in other sessions

| # | Issue | Status |
|---|---|---|
| 7 | AMZN `EARNINGS_BEAT` trigger fired 8× in 24h on a single signal — cooldown not honored | ✅ per user, fixed in other session |

## Open — code-sized fixes

| # | Issue | Fix path |
|---|---|---|
| 8 | 6 PASS-on-watchlist theses with no triggers/horizon (Catalyst 4, Secular Theme 2, EV Catalyst 2). Agent rejected those tickers but the rows sit on the visible watchlist as decorative | One SQL: close them, force agent to mint fresh on next run. ~5 min. |
| 9 | `update_thesis` ignores `coreBelief` (2%), `keyAssumptions` (6%), `invalidationConds` (6%) of updates. The "what's the plan" structural fields are being skipped | Tighten schema description in `lib/agent/tools/update-thesis.ts` (same shape as #1 fix). ~30 min. |
| 10 | Failed run today (Global Event-Driven ETF Strategist, run `cmou099yd000204joyikfx7ut`, 0 tool calls in 4 minutes, no RunEvents) | Pull Inngest logs for that run ID. Likely model-loop crash before tool execution. |
| 11 | Overdue reviews not picked up by housekeeping cron (MRVL `nextReviewAt: 5d ago`, never re-reviewed) | Housekeeping cron query needs `nextReviewAt < NOW()` regardless of trigger state. Find the cron in `lib/inngest/functions/`. |
| 12 | Triggers fire 0× during agent runs vs 30× via cron in NEW window | Investigate trigger-evaluator integration with morning-research; agent isn't checking trigger state during the run |
| 13 | Discovery never produces results in analyst runs (no INITIATE from discovery, only from new-thesis path) | Verify discovery cron ran + signals routed; or agent prompt doesn't wire discovery output back into action |
| 14 | `manage_position` never called in NEW era. **Caveat: partly misframed** — paper-trading stops are thesis-side via `update_thesis.stopLoss`, which IS firing (CAPR stop changed 30→32 today). Gate matters more for trim/scale operations. | Add execution gate similar to PR #210's `place_trade` gate, but target the `manage_position` semantics specifically (scale, trail) |
| 14b | **Trigger templates don't account for held vs watching state.** `lib/agent/triggers/defaults.ts` `targetDefaults()` (and the other horizon templates) emit `EXIT` triggers off `stopLoss` regardless of whether the thesis is held. For a WATCHING thesis those make no semantic sense — there's nothing to exit. The right shape for a watching/LONG thesis is `ENTER` (or `REVIEW` framed as entry) triggers off the breakout level. Current behavior: WATCHING theses show `EXIT IF Price below $X` chips that can never fire usefully. | Refactor `defaultTriggersForHorizon()` to take a `status: 'HELD' \| 'WATCHING'` parameter and emit different baselines per state. For watching: PRICE_ABOVE entry/breakout → REVIEW(intent=ENTER), no stop-EXIT, news triggers as today. Update callers in `record-thesis.ts` and `manage-watchlist.ts` to pass status. |

## Open — design / vague

| # | Issue | Notes |
|---|---|---|
| 15 | Action layer ~80% atrophied (1 trade in 2 days). Architecture's biggest open question. | Tomorrow's run (after tonight's cleanup) is the next data point |
| 16 | Agent prompt rewards thesis maintenance over action | Best fixed by adding explicit "promote WATCHING→INITIATE when target near" rule to morning prompt |
| 17 | NVDA -6% with stop only 4% away, agent acknowledged China-geopolitical risk and held anyway | Same root cause as #15/#16 |
| 18 | Wall-clock +37% despite fewer tool calls | Likely `update_thesis` cost + `get_theses` returning bloat. **Should improve significantly after tonight's dedupe (251→65 rows).** Worth re-measuring after tomorrow's run |
| 19 | No `update_thesis` agent flow for promoting horizon (TRADE→COMPOUNDER). The architecture has the concept but no promotion path | Architectural gap — needs both schema/tool change and agent prompt update |

## Open — FE work (need design pass)

| # | Issue | Notes |
|---|---|---|
| 20 | Status pill (`Holding`/`Watching`) doesn't carry direction or horizon-intent. Should be a sentence: *"Watching for entry > $268 · 1.9% below"* or *"Holding 28 sh @ $35.03 · biotech catalyst trade · 1 of 30d"* | Component: `ThesisSheet` |
| 21 | Horizon shown as label, never explained. CATALYST/TARGET/TRADE/COMPOUNDER each need exit-policy meaning attached | Same component |
| 22 | "Most recent trigger" panel is a fragment without the outcome chain. Should show "trigger fired 6× in 24h → target raised twice → no further changes expected" | Same component |
| 23 | Activity log doesn't differentiate "edited in this run." Need a top-of-log callout when `tu.runId === currentRunId` | Same component |
| 24 | Triggers panel flat — should be grouped by EXIT IF / ENTRY IF / REVIEW IF, with proximity-to-fire ("12% below current") | Same component |
| 25 | "No triggers attached" message renders as helper text. Should be a warning state (the thesis cannot react to anything) | One-line render fix |
| 26 | Overdue review (`nextReviewAt < NOW()`) not flagged. Should be red pill | One-line render fix |
| 27 | Plan section doesn't exist. Needs both FE addition + #9 (data must be populated first) | Cross-cuts |
| 28 | No UI control to override horizon ("This NVDA is actually a long-term hold → COMPOUNDER") | New control on thesis sheet |
| 29 | Days-held / maxHoldDays progress indicator on TRADE-horizon cards (no way to see "7 of 14 days used") | Card render addition |
| 30 | Run-detail page lacks "Why this run touched these names?" panel — the trigger-fire chain that produced the run's edits is invisible | Run page restructure |
| 31 | "Reading X theses" section on run page should show trigger-fire count + last-fire timestamp per thesis row | Run page render |
| 32 | "Reviewed — no changes" entries should link back to the triggering trigger/signal | Per-sheet activity log |

## Day-trader analyst (separate session)

| # | Issue | Status |
|---|---|---|
| 33 | No DAY-only archetype in knowledge library | Other session |
| 34 | `PRICE_MOVE_PCT` / `VS_SMA` triggers don't fire on cron path (per `trigger-evaluator.ts:17` comment) | Other session / known limitation |
| 35 | No intraday discovery scan cron | Other session |

## Withdrew / misdiagnosed

| # | Issue | Why withdrew |
|---|---|---|
| ❌ | "manage_position narrate-vs-execute bug" (initial framing) | Today's run actually wrote stop changes via `update_thesis.stopLoss` (CAPR 30→32). The architecture uses thesis-side stops, not broker-side. Re-framed as #14 with narrower scope. |
| ❌ | "Plan section needs to exist because AMZN had null fields" | Other theses (SMCI, MRVL, INTC) have richer data via bullishView/bearishView/activity log. The AMZN gap was a data-quality outlier, not a sheet-design failure. Re-framed as #9 (populate the structural-belief fields via prompt fix). |

## Recommended next actions, ordered by leverage

**Tonight-sized:**
1. **#9** — `update_thesis` schema description tightening (require coreBelief/keyAssumptions/invalidationConds for substantive updates). Same shape as today's HOLD label fix. ~30 min.
2. **#8** — Close the 6 PASS-on-watchlist theses. ~1 SQL. ~5 min.
3. **#11** — Fix housekeeping cron to pick up overdue reviews. Find the right cron, add the WHERE condition.

**Multi-hour FE work:**
4. **#20-22** — Status line + horizon explanation + grouped triggers panel on `ThesisSheet`. Half-day.
5. **#30-32** — Run-detail trigger visibility. Half-day.
6. **#28-29** — Horizon override + days-held progress. ~1 day.

**Bigger commitments:**
7. **#15-17** — Action-layer push: stronger agent prompt rules for promoting WATCHING→INITIATE, manage_position gate. Iterate over multiple runs.
8. **#19** — Horizon promotion path (architectural, both tool and prompt).

## How to measure tomorrow

Re-run the validation query from the master plan against runs `created_at >= 2026-05-07`:

- Did `place_trade` count rise above 1?
- Did `manage_position` move off 0?
- Did decision verbs include INITIATE / WATCH (not just HOLD)?
- Did wall-clock seconds drop materially? (Should — `get_theses` returns 11-14 rows instead of 27-78.)
- Did any triggers fire DURING a run (not just via cron)?

If `avg_buys` is still 0 tomorrow despite the cleaner state, the action-layer fix
(#14-17) is the next required workstream.
