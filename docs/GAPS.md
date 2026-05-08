# Hindsight — Gaps

> **What this is:** the ordered punch list of every known gap between [`/agent-workflow`](../app/(root)/agent-workflow/page.tsx) (current state) and [`VISION.md`](./VISION.md) (target state). Each item has a severity, a concrete fix path, and the audit it came from.
>
> **How to use it:** start at the top. P0s block the product. P1s degrade quality but the system still functions. P2s are paper cuts. Don't skip levels.
>
> **Last refreshed:** 2026-05-08 — Monitor Health workstream (this session) closed P0-4, P1-2. Backfill recomputed Monitor counters from authoritative chain; total trades-sourced lifted 2 → 5 immediately. Earlier same-day: watching-thesis integrity workstream closed P0-2, P1-1, P1-7, P1-8, P2-3; admin sweep closed P0-3, P0-5d, P1-5, P1-6, P2-9. Original baseline 2026-05-07 from a 5-agent audit; successor to `ARCHITECTURE_DEEP_AUDIT.md` and `SESSION_AUDIT_2026_05_06.md` (both now archived).

---

## Production data snapshot — the numbers driving this list

These numbers are the empirical baseline for the gaps below. Re-run the queries in `ARCHITECTURE_DEEP_AUDIT.md` (legacy) to refresh.

### Action layer (TradeDecision counts since 2026-05-01)

| Day | INITIATE | EXIT | WATCH | HOLD |
|---|---|---|---|---|
| 2026-05-07 | **10** | **1** | **16** | 2 |
| 2026-05-06 | 1 | 0 | 0 | 7 |
| 2026-05-05 | 1 | 0 | 0 | 13 |
| 2026-05-04 | 0 | 0 | 0 | 5 |
| 2026-05-01 | 0 | 1 | 0 | 4 |

**Reading:** 5/07 was the first day post-cleanup-and-PR-217. Action-layer atrophy lifted dramatically — 10 INITIATEs and 16 WATCH actions in one day vs ~1 INITIATE total in the prior week. **The architecture is now actually trading**, but only one observation since the fix; trend not confirmed.

### Open theses by analyst (2026-05-07)

| Analyst | Active | Watching | with coreBelief | with keyAssumptions | with invalidationConds |
|---|---|---|---|---|---|
| Catalyst Event Raider | 1 | 5 | 1 | 1 | 4 |
| Earnings Drift Trader | 3 | 6 | 6 | 4 | 4 |
| EV Catalyst Event Trader | 1 | 6 | **0** | **0** | **0** |
| Global Event-Driven ETF | 1 | 14 | 3 | 3 | 3 |
| Intraday Momentum Scalper | 1 | 2 | 1 | 3 | 3 |
| Secular Theme Architect | 2 | 5 | 2 | 2 | 2 |
| Tech Momentum Trader | 1 | 5 | 4 | 4 | 4 |
| **Total** | **10** | **43** | **17 / 53 (32%)** | **17 / 53 (32%)** | **20 / 53 (38%)** |

**Reading:** ~⅔ of open theses have null structural-belief fields. EV Catalyst Trader is the worst offender — zero theses with any of them populated. The agent is treating these fields as optional even though they're load-bearing for sheet rendering and tactical-run reasoning.

### Watching trigger health (2026-05-08, post watching-integrity workstream)

| Analyst | Watching | with ENTER | with EXIT | zero triggers | avg/thesis |
|---|---|---|---|---|---|
| Catalyst Event Raider | 5 | 4 | 0 | 0 | 4.6 |
| Earnings Drift Trader | 6 | 4 | 0 | 0 | 4.2 |
| EV Catalyst Event Trader | 6 | 1 | 0 | 0 | 4.2 |
| Global Event-Driven ETF | 14 | 12 | 0 | 0 | 4.9 |
| Intraday Momentum Scalper | 2 | 2 | 0 | 0 | 5.0 |
| Secular Theme Architect | 5 | 4 | 0 | 0 | 4.6 |
| Tech Momentum Trader | 5 | 2 | 0 | 0 | 4.2 |

**Reading:** numbers identical to 2026-05-07 (no new WATCHING theses landed in directional spots). The 14 watching theses without ENTER triggers — previously flagged as a 26% bug — are **all `direction: PASS`**, which by design don't get ENTER triggers (they're institutional memory, not entry-gated). The "missing ENTER" line was a measurement issue, not a coverage hole. Going forward, `record_thesis` rejects new directional WATCHING theses that lack an ENTER trigger (parity with manage_watchlist). See "Done since" → P1-1.

### Goalpost-moving check (2026-05-07)

The MRVL anti-pattern (raising target on a watching thesis when current price is already at/above the old target, instead of trading): **0 occurrences on 5/07.** Either the agent stopped doing it, or it actually traded the names that would have triggered it (which fits the 10 INITIATE count). Caveat: one day of data, can't conclude trend yet.

### Monitor health (2026-05-08, post P0-4 / P1-2 fixes)

| Type | Count | Enabled | Disabled | Trades sourced | Wins | Losses |
|---|---|---|---|---|---|---|
| API | 4 | 4 | 0 | 0 | 0 | 0 |
| DOMAIN | 42 | 42 | 0 | 0 | 0 | 0 |
| EMAIL | 26 | 26 | 0 | 0 | 0 | 0 |
| SEARCH | 76 | 44 | **32** | **5** | 2 | 0 |
| **Total** | **148** | **116** | **32** | **5** | **2** | **0** |

**Reading:** Trades-sourced lifted from 2 → 5 after the P0-4 backfill recomputed counters from the canonical chain. 32 SEARCH monitors are now soft-disabled (`enabled: false`) — they're skipped by firm-market-sweep / domain-monitor (which both filter by `enabled: true`) but the rows are kept so historical signals citing them still resolve. Monitor ROI tracer is wired and crediting; the remaining gap is **provenance population** — only 9% of closed positions since 4/01 carry `sourceSignalIds`, because the agent overwhelmingly picks `WEB_SEARCH` provenance over `ROUTED_SIGNAL` even when read_signals informed the thesis. Prompt-tightening + a soft-nudge in `record_thesis` (this PR) push that back up.

---

## P0 — Blocks the product

These prevent the core loop from working as designed. Fix first.

### P0-1 — `update_thesis` ignores structural belief fields
**Source:** ARCHITECTURE_DEEP_AUDIT (Step 4) + Supabase: 32% / 32% / 38% population for coreBelief / keyAssumptions / invalidationConds. EV Catalyst Trader has 0%.

**Why it matters:** these fields are how the thesis says "what's the actual claim, what must be true, what would prove it wrong." Without them, the thesis sheet's Plan section can't render anything substantive, the tactical run has no basis for "is this trigger actually invalidating my thesis," and post-trade evaluation has nothing to grade against.

**Fix path:**
1. Tighten the schema description in `lib/agent/tools/update-thesis.ts` — any update that changes more than rationale must include at least one structural belief field (or explicitly document why none changed).
2. Add a runtime guard: refuse `update_thesis` calls that touch confidenceScore / horizon / target / stop without any structural-field change AND without an explicit `structural_unchanged_reason` parameter.
3. Tighten the same fields in `record_thesis` — currently optional, should be required for non-PASS theses.

**Effort:** ~1 hour (tool schema + validation + prompt language).

### P0-5 — Horizon awareness is mostly cosmetic
**Source:** Hold-style audit (overall grade D+).

**Why it matters:** this is the most important pillar from VISION.md and the one most at risk. The system says it's horizon-aware (triggers differ per horizon, A-) but doesn't behave horizon-aware (daily prompt grade C, action layer D, data fetching F).

**Fix path (sub-items, in order):**
1. **P0-5a** — Make horizon visible in the daily-run prompt portfolio + Live Theses tables (currently absent; agent must click into the thesis card to remember exit policy).
2. **P0-5b** — Move time-based exit enforcement from prompt to code. `lib/trade-exit.ts` and `lib/inngest/functions/price-monitor.ts` should accept and respect `Thesis.horizon`. Code rule: `if (horizon === "TRADE" && daysHeld >= maxHoldDays) → trigger REVIEW`.
3. **P0-5c** — Branch daily prompt on horizon. Separate alert thresholds: "5% of stop" for TRADE, "10% of stop" for COMPOUNDER. Separate guidance: "COMPOUNDER theses ignore intraday moves <-3% absent fundamental invalidation."
4. ~~**P0-5d** — Add horizon promotion path.~~ Closed 2026-05-08 (admin sweep PR).
5. **P0-5e** — Differentiate data fetching per horizon. Long-term theses should pull SEC filings + analyst consensus more; intraday should pull options flow + volume.

**Effort:** ~1-2 days for P0-5a through P0-5c. P0-5e is bigger.

---

## P1 — Quality is degraded but system functions


### P1-4 — Discovery softer than required at minting
**Source:** Prompts audit — the discovery-to-action wiring softer than ARCHITECTURE_DEEP_AUDIT Step 6 requires.

**Why it matters:** the prompt says "Research ≥ 2 new tickers every run; worthy names go to watchlist via manage_watchlist." Audit demanded "convert at least N high-conviction signals to fresh `record_thesis` calls when discovery slots are open." Watchlist items don't trigger the per-thesis review loop the same way.

**Fix path:** sharpen the prompt language in the daily-run + discovery prompts. "Watchlist add" is the fallback; `record_thesis` (WATCHING status) is the default for high-conviction discoveries.

**Effort:** ~30 min.

---

## P2 — Paper cuts and FE polish


### P2-4 — No DAY horizon
SESSION_AUDIT items 33-35. Intraday Momentum Scalper analyst exists but mints theses with `horizon: "TRADE"` (14d max). DAY enforcement happens via EOD-flatten cron, not horizon logic. Decision needed: add a DAY horizon, or document that DAY-style runs use TRADE + EOD-flatten composition. ~1 day if adding the horizon.


### P2-7 — Intelligence pipeline crons are independent
Crons agent — no Inngest `.after()` or `.waitFor()` between firm-market-sweep → portfolio-watchlist-monitor → domain-monitor → signal-router. If one lags, downstream still fires on schedule with stale data. Today this is theoretical; flag it as a known fragility. ~2 hours to add chaining.

---

## Done since 2026-05-08 (small sweep — P1-3, P2-2, P2-5)

PR: [#238 — chore: small sweep — P1-3 cadence doc, P2-2 watchlist default, P2-5 dead code](https://github.com/dave-sucks/hindsight/pull/238)

- ✅ **P1-3 — Trigger evaluator cadence doc corrected.** CLAUDE.md had "every 15 min" in two places (Architecture/Reactivity section and Inngest Crons section). Updated both to "hourly". Registry was already correct (`workflow-registry.ts` schedule field and the Done-since note from 2026-05-07). No code change — the cron itself (`0 9,10,11,12,13,14,15,16 * * 1-5`) was always hourly; only the docs were wrong.
- ✅ **P2-2 — `manage_watchlist` default horizon changed TRADE → TARGET.** `ensureWatchingThesisForWatchlistAdd()` in [`lib/agent/tools/manage-watchlist.ts`](../lib/agent/tools/manage-watchlist.ts): default when no catalyst is supplied is now TARGET (open-ended hold, exits at target/stop/invalidation). `reviewDays` updated from the 1d TRADE default to 30d for TARGET. `maxHoldDays` already defaults to null for non-TRADE horizons — no change needed there. Tool description updated to document all three horizon options. No external callers relied on the TRADE default — the horizon is derived internally from the `catalyst` field presence.
- ✅ **P2-5 — `sync-heartbeat.ts` deleted.** Note: the audit's claim that it wasn't in `functions[]` was wrong — `syncHeartbeat` was imported and registered at `route.ts:36`. However the product owner's decision to delete stands. Removed the import (`route.ts` line 5) and the `functions[]` entry (`route.ts` line 36), then deleted the file. No other references in the codebase except `portfolio.actions.ts:537` which is a comment describing the prior cron cadence — that line does not import or call the function, so no change needed there.

---

## Done since 2026-05-08 (Monitor Health workstream)

This session: closed P0-4, P1-2. PR pending — number to fill in once the branch lands.

- ✅ **P0-4 — Monitor ROI tracer wired (Pillar 5).** Diagnosis: the chain `Thesis.sourceSignalIds → Signal.monitorId → Monitor` was actually intact end-to-end — `trade-evaluator.ts` fires within 12–48s of every close, `Signal.monitorId` is populated on 39 of 39 cited signals, and `Monitor.{tradesSourced,winsSourced,lossesSourced,successScore}` does increment correctly via the transactional update at `trade-evaluator.ts:139-162`. The break was upstream at thesis minting: the agent overwhelmingly picks `source_kind: WEB_SEARCH` (8/10 on 5/07, 3/5 on 5/08) instead of `ROUTED_SIGNAL` even when read_signals informed the thesis. WEB_SEARCH provenance is allowed to leave `source_signal_ids` empty, which silently skips the credit chain. **Fixes (this PR):** (1) new `ToolContext.signalsByTicker` map; `read_signals` populates it on every return so record_thesis can detect the mismatch. (2) Soft-nudge in `record_thesis`: when `source_kind ≠ ROUTED_SIGNAL` for a ticker that appeared in this run's read_signals output, log a WARN + append a hint to the success message so the agent sees it in-context. No hard reject — would risk a regression and the thesis itself is fine. (3) Strengthened the `read_signals` tool description (citation is now imperative, not advisory) and added a "Provenance is not optional — pick the right kind" block to the daily-run system prompt explaining the 4 source_kind options and *why* (the credit chain). (4) **Backfill ran on production:** recomputed Monitor counters from the canonical chain via authoritative SQL — total trades-sourced lifted from 2 → 5; portfolio_searches went 2/2/0 → 3/2/0 (score 1.0 → 0.667), watchlist_searches 1/0/0 → 2/0/0. Idempotent — safe to re-run.
- ✅ **P1-2 — Dead SEARCH monitor cleanup.** `pipeline-cleanup.ts` gains Step 3: `enabled: false` on SEARCH monitors where `lastRunAt > 30 days ago AND tradesSourced = 0`. Soft-disable (not delete) — `Signal.monitorId` keeps its FK target, so historical signals still resolve and the trade-evaluator's chain walk for any open thesis citing them keeps working. Both `firm-market-sweep` and `domain-monitor` already filter by `enabled: true`, so disabled monitors auto-silence on the next cron tick. Existing dead population was already cleaned by a prior intervention (32 SEARCH monitors are currently `enabled: false`); the new rule keeps them disabled and catches future strays. No one-time SQL needed today (no monitors currently meet the 30d+0-trades cutoff that aren't already disabled).

---

## Done since 2026-05-08 (admin sweep)

Doc + prompt + tool-allowlist housekeeping. PR title "chore: admin sweep — P0-3 / P0-5d / P1-5 / P1-6 / P2-9".

- ✅ **P0-3 — Generalized narrate-vs-execute gate.** Verified PR #228 fully implements the design. `lib/agent/narration-gate.ts` is a pure verb→tool ruleset covering `manage_position` (tighten/trim/scale/move stop/trail/adjust), `close_position` (closing/exiting/sold/sell), and `manage_watchlist` (add/remove ... watchlist). Wired into `record_run_summary`'s persistence path: scans `decision_rationale` + each pick's `reasoning`, cross-references against `RunEvent` rows of type `position_closed | position_modified | watchlist_add | watchlist_remove`, emits a `run_failed` RunEvent and atomically transitions `ResearchRun: RUNNING → FAILED` on any mismatch. `complete_run`'s atomic transition was tightened from `status: { not: COMPLETE }` to `status: RUNNING`, so the FAILED status set by the gate sticks — that's the optional v2 "refuse complete_run on mismatch" half of the original fix path. `place_trade` is intentionally excluded from the verb list (gated upstream by morning-research's trade-execution gap check). 21 unit tests in `lib/agent/narration-gate.test.ts`.
- ✅ **P0-5d — Horizon promotion path on update_thesis.** Rewrote the `horizon` field schema description in [`update-thesis.ts`](../lib/agent/tools/update-thesis.ts) from "Rarely changed" (which actively discouraged the workflow) to a description that invites promotion with concrete examples: TRADE compounding past its 14d window → upgrade to TARGET; COMPOUNDER with eroded moat → downgrade to TARGET with tighter exit; CATALYST that printed and is now riding residual momentum → TARGET. Includes the must-do guardrail: any horizon change MUST also update `maxHoldDays` and `nextReviewAt` to the new horizon's defaults (TRADE 14d / TARGET 90d / COMPOUNDER 365d) — otherwise the thesis ends up with an exit policy that contradicts its label. No runtime guard yet (deferred to P0-5b territory).
- ✅ **P1-5 — Editor lane taxonomy in workflow-page prompt template.** The runtime editor prompt (`lib/agent/modes.ts → buildEditorSystemPrompt`) already documents all 4 lanes in detail (Step 0 — CLASSIFY THE REQUEST). The gap was on the documentation surface: `lib/agent/builder-prompt-template.ts` exported only a builder template, and the workflow-registry's editor card imported the same builder template — so users browsing `/agent-workflow` saw builder content under the editor card. New `EDITOR_PROMPT_TEMPLATE` export documents all four lanes (Q&A, numeric, fence, archetype) at the top with one-sentence descriptions of when each applies and how deeply it rewrites the analystPrompt. `workflow-registry.ts:239` updated to import it.
- ✅ **P1-6 — `get_sec_filings` builder allowlist.** Already done. `lib/agent/modes.ts:103` has `"get_sec_filings"` in the BUILDER `toolAllowlist`; registry's `agents: ["builder", "agent", "tactical", "discovery"]` matches. GAPS entry was stale relative to the code.
- ✅ **P2-9 — CLAUDE.md tool count refresh.** Updated heading from "19 tools" to "25 trading tools" with a line acknowledging the 3 podcast-only tools that live alongside but are out of scope. Itemized list adds: `get_portfolio_context`, `update_thesis`, `get_earnings_calendar`, `get_market_movers`, `manage_position` (was nested under close_position as 14b), `ask_question`, `discover_signals_for_fence`, `read_analyst_inbox_stats`, `suggest_config`. Cross-checked against `TOOL_REGISTRY` and `lib/agent/tools/` directory.
- ✅ **P2-1 — 6 PASS-on-watchlist theses with no triggers.** Closed as stale. The watching-thesis integrity workstream's reframe of P1-1 covers this directly: PASS-direction theses are institutional-memory rows that by design don't carry ENTER triggers — there's no entry to trigger on. The "6 zero-trigger PASS theses" the audit flagged are the same population as the 14 PASS-direction watching theses already accounted for. No SQL fix needed.
- ✅ **P2-8 — Briefing isn't a separate cron.** Closed. The 2026-05-07 registry edit changed briefing's `schedule` field to "Inline after every run (no separate cron)" — that's the documentation fix the gap was asking for. No code change, no further work.
- ✅ **P2-10 — Podcast tools missing from TOOL_REGISTRY.** Closed as intentional. The registry's header comment now explicitly scopes the podcast feature out of `/agent-workflow` — `read_past_transcripts`, `suggest_podcast_config`, `write_segment_transcript` live in `lib/agent/tools/` alongside the trading tools but are part of the podcast surface (`lib/podcast/`, `docs/PODCAST_PLAN.md`). Revisit only if podcast becomes a first-class feature on the workflow page.

---

## Done since 2026-05-08 (watching-thesis integrity workstream)

This session: closed P0-2, P1-1, P1-7, P1-8, P2-3. PR pending — number to fill in once the branch lands.

- ✅ **P0-2 — Promotion check enforced at runtime.** New state-based gate in `record_run_summary`: for every WATCHING/LONG-or-SHORT thesis owned by the analyst, fetches the latest quote, evaluates the entry condition, and marks the run FAILED unless either (a) a `place_trade` INITIATE TradeDecision landed for that ticker, (b) an `update_thesis(change_status: INVALIDATED)` ThesisUpdate landed, or (c) the rationale corpus names the ticker AND contains a concrete rejection keyword (volume / regime / news / R/R / liquidity / etc.). Same FAILED severity as the existing narration→execution gate. The MRVL pattern (raise target, walk away) has been blocked at the `update_thesis` layer since PR #232; this gate catches the broader "did absolutely nothing" case.
- ✅ **P1-1 — Reframed and resolved.** The audit's "11 of 43 watching theses missing ENTER triggers" was a measurement issue. Rerunning the trigger-health query 2026-05-08: of the 14 watching theses without ENTER triggers, **all 14 have `direction: PASS`** — institutional-memory theses that by design don't get ENTER triggers. Zero directional (LONG/SHORT) watching theses in production lack an ENTER trigger. To prevent regressions: `record_thesis` now rejects WATCHING + LONG-or-SHORT mints whose merged trigger array contains zero ENTER actions (parity with the existing `manage_watchlist` guard).
- ✅ **P1-7 — Overdue reviews fire daily.** New `housekeeping-overdue-theses` Inngest cron, hourly during US market hours. Queries every ACTIVE/WATCHING thesis with `nextReviewAt < NOW() AND closedAt IS NULL`; writes one synthetic `ThesisUpdate(type=TRIGGER_FIRED, triggerId=__OVERDUE_REVIEW__)` per overdue thesis with a 24h per-thesis cooldown. The next Daily Run for the analyst surfaces the row in its prompt's "Triggers Fired Since Your Last Run" priority block (run-input.ts adapted to label the synthetic id as "scheduled review overdue"). Test population on 2026-05-08: 14 watching PASS theses with `nextReviewAt = 2026-05-02` (6 days overdue) — the cron's first market-hours tick will fire 14 synthetic rows.
- ✅ **P1-8 — Already addressed.** Triggers DO fire during agent runs via `triggersMatchingNow` in [`run-input.ts`](../lib/agent/run-input.ts) (server-side `evaluateLiveTriggerMatches` at run start, surfaced as Section 7 of the system prompt). The audit's "0×" finding was pre-PR. Marking P1-8 closed; no action needed.
- ✅ **P2-3 — Per-horizon WATCHING templates.** [`defaults.ts`](../lib/agent/triggers/defaults.ts) `defaultTriggersForHorizon(_, _, "WATCHING")` now branches on horizon: WATCHING/CATALYST gets filing+earnings REVIEW + 14d hygiene; WATCHING/TRADE gets a tight ENTER + 14d hygiene (matches max-hold); WATCHING/TARGET keeps the current shape (entry + support REVIEW + 30d hygiene); WATCHING/COMPOUNDER gets a patient ENTER (7d cooldown — ignore wiggles), guidance-cut REVIEW, and 90d hygiene. All four templates carry `REVIEW_DATE_HIT` so the trigger-evaluator's 5-min cron auto-fires when `nextReviewAt` lands.
- ✅ **Self-healing prompt language.** Step 2.A NO branch in [`system-prompt.ts`](../lib/agent/system-prompt.ts) now requires the agent to inspect a WATCHING thesis's triggers[] before logging REVIEWED — if the array has zero ENTER triggers (or only legacy EXIT triggers), it's malformed and must be repaired via `update_thesis(triggers: [...])` or explicitly closed via `change_status: INVALIDATED`. The existing `update_thesis` zero-trigger guard backstops this — REVIEWED-only updates on zero-trigger theses are already rejected.

**Verification 2026-05-08 (production):**
- Goalpost-moves since 2026-05-07: **0** (5 in the prior 7-day window, all on AMZN by Catalyst Event Raider 5/05–5/06 — pre-existing baseline).
- New WATCHING theses 2026-05-07: **5** (MRVL, MU, AMKR, SMCI, FIVN). All directional, all have ENTER + target + horizon + ≥2 keyAssumptions + ≥2 invalidationConds. coreBelief 3 of 5 (60%) — the rest is the P0-1 structural-fields work, separate session.
- Manual cron sanity check via Inngest dashboard pending — outside this session's automated reach.

---

## Done since 2026-05-06 audit (prior session)

For posterity — what got fixed in the 2026-05-06 → 2026-05-07 window:

- ✅ `defaultTriggersForHorizon()` now takes a `state: 'HELD' | 'WATCHING'` param. WATCHING templates emit `ENTER` triggers (no EXIT). 39 watching theses re-backfilled. (PR #217)
- ✅ Watching trigger health: 0 EXIT triggers on watching theses (down from majority); 0 zero-trigger watching theses (down from 11).
- ✅ Action layer recovered: 10 INITIATEs on 5/07 vs ~1 in the prior week.
- ✅ Goalpost-moving anti-pattern: 0 occurrences on 5/07 (vs the documented MRVL incident).
- ✅ `record_run_summary` no longer drops WATCH actions (PR from 2026-05-06 session).
- ✅ Workflow registry schedule clarifications: trigger evaluator (hourly + on event), discovery (Sunday weekly), briefing (inline). (2026-05-07)
- ✅ Workflow registry has `LAST_VERIFIED_AT` and the page surfaces it. (2026-05-07)
- ✅ Doc cleanup: 24 stale planning + handoff docs moved to `docs/legacy/`. (2026-05-07)
- ✅ Recent commit-level fixes since the audit (still need verification on next morning run):
  - PR #226 — close prose-termination gap that failed 3/7 morning runs on 5/07
  - PR #228 — generalize narration→execution gate to manage_position, close_position, manage_watchlist
  - PR #229 — teach prompt to recompute target/stop on WATCHING→ACTIVE promotion
  - PR #230 — close prose-termination gap in tactical-run (mirrors #226)
  - PR #232 — block inverted-target theses at write time (record + update)

**Important caveat:** PR #228 in particular *claims* to generalize the narrate-vs-execute gate. This GAPS doc still lists P0-3 (generalized narrate-vs-execute) as open because the audit didn't verify whether #228 actually implements the full design or just adds a per-tool check. Verify before closing.

---

## Cancelled

Items deliberately not pursued. Recorded so future sessions don't re-add them.

- ❌ **P2-6 — Thesis sheet UI items** (cancelled by user 2026-05-08). The thesis-sheet redesign as scoped (sentence-style status pill, exit-policy explanation on horizon, proximity-to-fire trigger chips, "edited in this run" activity-log call-outs, Plan section, horizon override control, days-held progress, overdue-review red flag, run-detail "Why these tickers?" panel) is not being pursued in its current form. Individual sub-pieces may resurface as their own scoped gaps if they become load-bearing for the daily loop, but the bundled redesign is shelved.

---

## How to keep this doc honest

1. When a fix lands, move the item to "Done since" with the PR number.
2. When a new gap is found, add it to the right priority section (don't dump everything in P2).
3. When the production-data snapshot is more than 7 days old, re-run the queries.
4. When the workflow page diverges from this doc, **the workflow page is right** — update GAPS.md to match. The page is the source of current state; this doc is a delta against the vision.
