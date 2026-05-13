# Hindsight — Gaps

> **What this is:** open items and recent-done trajectory for the **thesis architecture rework**. Scoped: this is the tracker for the multi-PR effort to get the durable-thesis system tight (discovery → watching → trigger → tactical → daily-run review → action). Not a general bug tracker.
>
> **Where things go:**
> - Open item on the thesis rework → here.
> - Code smell / fragility outside the rework → [`TECH_DEBT.md`](./TECH_DEBT.md).
> - "What shipped in PR #X?" → GitHub PRs (search by label or date).
> - Product north star → [`VISION.md`](./VISION.md).
> - Live thesis-system reference → [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md).
> - Big multi-PR plans → `docs/<NAME>_PLAN.md` (e.g., [`WATCHLIST_COLLAPSE_PLAN.md`](./WATCHLIST_COLLAPSE_PLAN.md)).
>
> **How to use it:** start at P0. P0s block the rework's correctness. P1s degrade quality. P2s are papercuts but still part of the rework. Don't skip levels. When something closes, **move it** to a "Done since" section below, not strike-through inline.
>
> **Most recent major movement:** Discovery Run full rework (PR #253, 2026-05-11) — see "Done since 2026-05-11" below. Surfaced and filed: P1-9, P1-10, P2-10, P2-11, P2-12.

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

### P0-5 — Horizon awareness: operational layers are still horizon-blind
**Source:** Hold-style audit 2026-05-07 (original grade D+; substantially upgraded by PR #239 which shipped horizon visibility + per-horizon prompt rules).

**The umbrella problem (in plain English):** the system has horizon as a label and shows it in the daily prompt, but the **operational layers that run between morning runs** — the hourly price-monitor cron, the specific numeric thresholds in the prompt, the data the agent fetches — still treat every position identically. Three sub-items below; they're three layers of the same gap.

**Fix path (sub-items, in order):**

1. ~~**P0-5a** — Make horizon visible in the daily-run prompt.~~ ✅ Closed 2026-05-08 (Thesis Architecture, PR #239) — Live Theses table renders horizon, schedule, and per-thesis exit-policy hint sourced from `lib/agent/horizon-policy.ts`.

2. ~~**P0-5b** — Wire `horizon-policy.ts` constants into the hourly watchdog.~~ ✅ Closed 2026-05-10 (Morning Run V2 PR — Fix #0). Resolved by deletion, not by horizon-aware branching: per-thesis triggers in `lib/agent/triggers/*` are now authoritative. `price-monitor.ts` no longer auto-closes (the unconditional `checkExitConditions` call is now TRAILING-only); `trade-exit.ts` was gutted to TRAILING + MANUAL only; the NEAR_TARGET / NEAR_STOP `PositionManagementAction` writes are gone. The 6-month-TARGET-tanks-on-noise scenario is now controlled by the agent's own `PRICE_BELOW level: stop` EXIT trigger, evaluated by the trigger evaluator's 5-min cron. The TRADE-hits-maxHoldDays scenario fires the per-thesis `TIME_ELAPSED days: maxHoldDays` REVIEW trigger from `lib/agent/triggers/defaults.ts`, which spawns a tactical run mid-session. Horizon awareness lives where it belongs (per-thesis triggers the agent set), not in a generic cron threshold layer.

3. ~~**P0-5c** — Per-horizon proximity thresholds in Step 2.B of the daily-run prompt.~~ ✅ Closed 2026-05-10 (Morning Run V2 PR — Fix #1 + Fix #2). The V1 prompt's Step 2.B "Within 5% of stopLoss → MUST call manage_position" rule is gone in V2 — replaced by `get_theses.needsAction` which is purely trigger-driven (no hardcoded proximity). If the agent wants warning at 5% from stop, it should add a `PRICE_BELOW level: stop * 1.05, action: REVIEW` trigger when minting the thesis. The `computeNeedsAction` kinds are TRIGGER_FIRED / TRIGGER_MATCHING_NOW / REVIEW_DUE only; NEAR_TARGET / NEAR_STOP / ENTRY_MET were considered and explicitly rejected (see `lib/agent/needs-action.test.ts` anti-regression assertions).

4. ~~**P0-5d** — Add horizon promotion path.~~ ✅ Closed 2026-05-08 (admin sweep PR).

5. **P0-5e** — **Per-horizon data-fetching guidance in the prompt.** The data-fetching tools (`get_stock_data`, `get_options_flow`, `get_sec_filings`, `get_earnings_data`, etc.) don't take horizon as input — but they don't need to. The actual fix is prompt guidance: "Reviewing a TRADE position? Pull options flow + technical setup. Reviewing a COMPOUNDER? Pull SEC filings + analyst targets + earnings calendar." Today the agent picks whatever it picks; quality suffers when the data type doesn't match the horizon. **Reframed as P1 (prompt fix, not code fix). Effort: ~1 hour.**

**Total remaining:** P0-5b and P0-5c closed 2026-05-10 by the Morning Run V2 PR (resolution by deletion of the parallel layers, not by adding horizon-aware branching there — per-thesis triggers are authoritative now). Only P0-5e remains; ~1 hour, prompt-only.

---

## P1 — Quality is degraded but system functions

*(P1-4 was closed via cumulative prompt sharpening across PRs #235 + #239 — see "Done since" below. P0-5e was downgraded here from P0; see P0-5 above for details.)*

### P1-9 — Discovery prompt is archetype-blind
**Source:** Discovery review 2026-05-11 (see `DISCOVERY_REVIEW.md`). The 4-dimension scoring rubric (trendStrength / relativeStrength / entryQuality / catalystFreshness) is calibrated for momentum/breakout playbooks and applied universally. A Deep Value Contrarian buys downtrends — `trendStrength: 3` is a SELL signal for them. An Insider Cluster Buying archetype has no slot in the rubric for Form 4 cluster patterns. Catalyst Event Trader / Earnings Drift should weight earnings_calendar heavily; momentum scoring barely.

**Fix path:** branch the discovery prompt into three families — EVENT_DRIVEN (Earnings Drift, Catalyst Event), MOMENTUM (Momentum Breakout, Mean Reversion, Sector Rotation, Unusual Options), FUNDAMENTAL (Deep Value, Thematic Secular, Insider Cluster) — each with a tuned scoring rubric and primary source priority. Requires either an `AgentConfig.archetypeId` column or runtime classification from analystPrompt + holdDurations. Full spec in `DISCOVERY_REVIEW.md` § Proposed redesign. ~1 session of work.

### P1-10 — Producers don't emit `intelligence/route-signals` event
The signal-router has `{ event: "intelligence/route-signals" }` as a trigger but **nothing in the codebase emits that event**. Fresh signals from firm-market-sweep / portfolio-watchlist-monitor / domain-monitor wait for the next 7:30am router cron tick (now daily — see 2026-05-11 Done) rather than routing immediately on landing. Adds 15-60 minutes latency between signal creation and route availability. Fix: each producer cron emits the event at the end of its step.run. ~30 min.

---

## P2 — Paper cuts and FE polish


### P2-4 — No DAY horizon
SESSION_AUDIT items 33-35. Intraday Momentum Scalper analyst exists but mints theses with `horizon: "TRADE"` (14d max). DAY enforcement happens via EOD-flatten cron, not horizon logic. Decision needed: add a DAY horizon, or document that DAY-style runs use TRADE + EOD-flatten composition. ~1 day if adding the horizon.


### P2-7 — Intelligence pipeline crons are independent
Crons agent — no Inngest `.after()` or `.waitFor()` between firm-market-sweep → portfolio-watchlist-monitor → domain-monitor → signal-router. If one lags, downstream still fires on schedule with stale data. Today this is theoretical; flag it as a known fragility. ~2 hours to add chaining.


### P2-10 — Discovery run idempotency on Inngest retries
`discovery-run.ts` creates the `ResearchRun` row inside `step.run("discovery-${id}", ...)` BEFORE the try/catch around `generateText`. An Inngest step retry after a transient prisma/OpenAI failure creates a second ResearchRun row for the same analyst-week → duplicate theses + double LLM billing. Fix: wrap the create + generateText in a single try/catch, or move the create outside the step (with an idempotency key on `agentConfigId + weekStart`). ~30 min.


### P2-11 — Discovery FAILED status hides successful theses
`discovery-run.ts` sets `status = COMPLETE` only if `record_run_summary` fired. A run that mints 5 valid WATCHING theses but token-limits before the summary lands as `FAILED`. The work is real; the badge says it isn't. Fix: branch on `newTheses > 0` — `newTheses > 0 && ranSummary` → COMPLETE, `newTheses > 0 && !ranSummary` → COMPLETE_PARTIAL (or COMPLETE with a flag), `newTheses === 0 && !ranSummary` → FAILED. ~20 min.


### P2-12 — Discovery prompt doesn't mention `manage_watchlist`
`manage_watchlist` is in `MODES.discovery.toolAllowlist` but the prompt never names it. The watchlist ↔ WATCHING-thesis collapse (per `docs/THESIS_ARCHITECTURE_PLAN.md`) is pending, so today an analyst can add watchlist names without a thesis — but discovery can't surface that affordance because the prompt is silent. Either remove the tool from the allowlist (forcing every name to mint a WATCHING thesis) or add prompt guidance. Decide after the watchlist collapse lands.

---

## Done since 2026-05-11 (Discovery Run — full rework)

End-to-end Discovery cron + prompt + tool rework, driven by the 2026-05-10 weekly auto-cron that minted zero theses across all seven enabled analysts. Root cause was a stack of compounding issues, not a single bug — see `DISCOVERY_REVIEW.md` for the full review.

**The dominant root cause:** `read_signals` defaulted to `lookbackDays: 0` (today-only), AND the four intelligence-pipeline crons (firm-market-sweep, portfolio-watchlist-monitor, domain-monitor, signal-router) all ran Mon-Fri only. On Sunday 9am ET, `AnalystSignalRoute` had **zero** rows for "today" because the router never fired on Sunday. The discovery agent saw an empty inbox by construction, regardless of what was in the prompt.

**Adjacent root causes, also fixed:**

- The discovery prompt **truncated the analyst's `analystPrompt` to 400 characters** — the agent was operating without its own strategy, signal preferences, or risk philosophy. The first paragraph of an analyst's identity, applied as if it were the whole thing.
- The prompt was passed only 6 of ~14 strategy-relevant fields from `AgentConfig`. Direction bias, hold durations, signal types, position sizing, market cap bounds, and the analyst's watchlist were all withheld.
- The prompt told the agent to apply the universe fence manually — but the router already enforced it at routing time. Agent-side filtering was both wasted work and an error surface.
- `scope:"universe"` on movers + earnings tools intersected with `watchlist + positions` (i.e. coverage), which is the OPPOSITE of what discovery wants. Already fixed by PR #247 — confirmed.
- The composite ≥ 7 threshold was the daily-run "tradeable today" bar. Discovery's job is to seed WATCHING for the daily run to evaluate later; the bar should be lower.
- Step 2 said "Pick the 2-3 most promising candidates BEFORE scoring." Lossy pre-prune with no methodology — discarded 5+ candidates unscored.
- DAY-only analysts were running the weekly cron. A weekly WATCHING thesis with an intraday-level ENTER trigger is architecturally broken — Monday's premarket gap moves the breakout level. They shouldn't be in the cron at all.
- The prompt gave **zero guidance on horizon selection** — VISION's load-bearing concept — and zero guidance on deriving target_price + stop_loss, even though `record_thesis` rejects WATCHING/LONG or WATCHING/SHORT without a target_price (because the default ENTER trigger keys off it).
- No cross-analyst overlap check at the workflow level. The 2026-05-10 EV Catalyst case (3 attempts to mint $MU, all rejected by the same-direction guard) is what that gap looks like.

**Shipped fixes:**

- ✅ **`read_signals` defaults `lookbackDays: 7` in discovery mode.** Single source of truth — the cron and the prompt don't have to pass it. Daily-run mode still defaults to 0 (today-only).
- ✅ **All four intelligence-pipeline crons now run daily (`* * *`)** — firm-market-sweep (6:30am), portfolio-watchlist-monitor (7:00am), domain-monitor (7:15am), signal-router (7:30am). Weekend news (M&A, pre-announces, policy moves) now gets routed before Sunday's Discovery cron at 9am.
- ✅ **`discovery-run.ts` passes the FULL `analystPrompt`** (no truncation) plus 8 additional fields: `holdDurations`, `directionBias`, `minConfidence`, `maxPositionSize`, `maxOpenPositions`, `signalTypes`, `watchlist`, `marketCapMin`, `marketCapMax`.
- ✅ **Discovery prompt rewritten as a TRADER's prompt, not a filter.** New sections: "YOUR CONFIG — what bounds your work" (direction bias / hold style / signal types / watchlist), "WHAT'S ALREADY DONE FOR YOU — DO NOT RE-FILTER" (router fenced; tools coverage-excluded), "PICKING THE RIGHT HORIZON" (CATALYST/TRADE/TARGET/COMPOUNDER decision tree mapping VISION Part 2's hold-style spectrum), "TARGET, ENTRY, STOP — REQUIRED on every directional thesis" (derivation guidance from real chart structure + R/R ≥ 2:1 + direction shape enforcement), "DON'T DUPLICATE OTHER ANALYSTS" (cross-analyst overlap check).
- ✅ **Step 2 cross-analyst pre-check.** Agent calls `get_theses(tickers: [<candidate>])` before `get_stock_data` to avoid wasting research on a name another analyst already covers in the same direction.
- ✅ **Pre-prune removed.** Step 2 now says "research every promising candidate (typically 6-10 names)" instead of capping at 2-3. Score all, mint the ones that clear the bar.
- ✅ **Composite threshold lowered to 5 for WATCHING**, 8 for high-conviction ACTIVE. The WATCHING bar is "worth tracking," not "tradeable today."
- ✅ **Cap raised 5 → 8 new theses** per run (typical range 2-5).
- ✅ **DAY-only analysts skipped in the cron.** `holdDurations === ["DAY"]` analysts are filtered out (manual `targetConfigId` fire still passes through for testing).
- ✅ **Kickoff user prompt rewritten** to match the new prompt: parallel pull of all three surfaces, no manual re-filter, mint everything ≥ 5, up to 8.
- ✅ **Stale "Mon-Fri only" justifications removed** from the prompt and `read-signals.ts` comments now that the routing crons run daily.

**Files touched:**
- `lib/agent/tools/read-signals.ts` — default `lookbackDays = 7` when `ctx.discoveryOnly`
- `lib/agent/system-prompts/discovery.ts` — full rewrite (~245 lines → ~405 lines)
- `lib/inngest/functions/discovery-run.ts` — DAY-only skip, full config passthrough, new kickoff prompt
- `lib/inngest/functions/firm-market-sweep.ts` — `1-5` → `*`
- `lib/inngest/functions/portfolio-watchlist-monitor.ts` — `1-5` → `*`
- `lib/inngest/functions/domain-monitor.ts` — `1-5` → `*`
- `lib/inngest/functions/signal-router.ts` — `1-5` → `*`

**Known issues NOT addressed in this pass** (filed as P1/P2 above): P1-9 archetype-blind scoring rubric, P1-10 producers don't emit `intelligence/route-signals`, P2-10 idempotency on step.run retries, P2-11 FAILED status hides successful theses, P2-12 `manage_watchlist` not in prompt.

---

## Done since 2026-05-10 (Morning Run V2 — operational layers delegate to triggers)

End-to-end Daily Run rework. ONE PR, seven fix commits + three docs commits. Closes P0-5b + P0-5c by deletion: the parallel layers that overrode per-thesis triggers are gone, so per-thesis triggers ARE the system's exit + reactivity logic now (not just a label that lived alongside competing crons). Verified by: `SELECT id, ticker, status, jsonb_array_length(triggers) AS trigger_count FROM "Thesis" WHERE status='ACTIVE' AND jsonb_array_length(triggers) = 0;` returned `[]` before landing — every ACTIVE thesis already carries triggers, so removing the auto-close path doesn't strand any positions.

- ✅ **Fix #0 — Per-thesis triggers are now authoritative.** `place_trade` defaults `exitStrategy: "MANUAL"` (was `"PRICE_TARGET"`). `lib/trade-exit.ts` gutted to TRAILING + MANUAL only — PRICE_TARGET / TIME_BASED branches deleted, NEAR_TARGET / NEAR_STOP `PositionManagementAction` writes deleted. `lib/inngest/functions/price-monitor.ts` keeps peak/trough tracking + the near-target email + `PRICE_CHECK` events but no longer auto-closes; `checkExitConditions` is TRAILING-only via early-return so `manage_position.set_trailing_stop` continues to honor its trail-from-peak math. The trigger evaluator's 5-min cron path is now the sole consumer of price-vs-trigger evaluation. Test suite rescoped to TRAILING + MANUAL.
- ✅ **Fix #1 — Daily Run system prompt rewritten.** ~600 lines → ~80. `buildDailyRunSystemPromptV2` in `lib/agent/system-prompt.ts`. Goals + identity + standup, not procedural stages. The 5 priority blocks (Priority Reviews, Fired Triggers, Matching Now, Live Theses, Watchlist) are gone — that work moved into `get_theses.needsAction` (Fix #2). New `AgentConfig.useV2Prompt Boolean @default(false)` (migration `20260510000000_agent_config_use_v2_prompt`); morning-research branches on it to dispatch V1 vs V2 builder. `latestBriefing` field added to `RunInput` for the V2 "Yesterday's standup" section.
- ✅ **Fix #2 — `get_theses` returns trigger-driven `needsAction`.** New `lib/agent/needs-action.ts` helper, 14 unit tests in `needs-action.test.ts`. Three kinds — TRIGGER_FIRED / TRIGGER_MATCHING_NOW / REVIEW_DUE — all driven by predicates the agent set, not hardcoded thresholds. Anti-regression assertions: a 6-month TARGET hold with a $90 stop returns null at $97 (-3%), $119 (95% to target). Reuses `shouldFire` from `lib/agent/triggers/evaluate.ts`. `read-theses-table.tsx` renders an alert chip on rows where `needs_action != null`.
- ✅ **Fix #3 — `read_signals` sector firehose fallback removed.** Empty routing is real signal; the old fallback turned that into 50 sector-wide signals. Watchlist branch kept (analyst's curated explicit interests); sector / industry / theme branches deleted.
- ✅ **Fix #4 — Explicit unattended-cron user prompts.** V2 morning prompt: "It's the start of the trading day. Run your morning playbook unattended — there is no human to respond to questions. Every turn must call a tool; text-only turns terminate the run as FAILED. End with complete_run." Tactical-run prompt gets the same explicit-unattended language unflagged. V1 keeps the old wording during rollout.
- ✅ **Fix #5 — Daily Run tool allowlist locked.** `MODES["research-run"].toolAllowlist` was undefined; now explicit. Excludes `record_thesis` + `manage_watchlist`. Daily Run manages the existing book; new coverage minting is the Sunday Discovery cron's job (or `app/discovery.run.manual` on demand, or tactical promotion via `update_thesis(change_status: "ACTIVE")`). `morning-research.ts` now actually filters by the allowlist (mirror of `tactical-run.ts` and `discovery-run.ts` patterns); previously the cron passed every tool regardless of mode.
- ✅ **Fix #6 — `dailyRunOnly` flag on `read_signals`.** Mirror of the existing `discoveryOnly` pattern. When set (from morning-research, gated on `useV2Prompt`), hides the discoverySignals bucket from the V2 Daily Run's response — discovery candidates only show up in Sunday's Discovery Run.

**Rollout:** Fix #0 ships unflagged (correctness, not behavior — the parallel layer was never supposed to be authoritative). Fixes #1–#6 ship behind `AgentConfig.useV2Prompt` (default false). Flip Tech Momentum first; watch 5–7 trading days; flip the next analyst when it holds. Once every enabled analyst has been on V2 for ~7 days without regression, delete the V1 builder + the flag.

**Verification 2026-05-10:** tsc clean (only the two pre-existing unrelated errors in `GenerateAudioButton.tsx` + `transcript-row.tsx` remain — same baseline PR #239 acknowledged); 177/177 jest pass (14 new in `needs-action.test.ts`, 16 rescoped in `trade-exit.test.ts`, 147 prior). Pre-flight SQL on prod returned `[]` — no ACTIVE theses without triggers; all 10 currently-OPEN positions are `exitStrategy='PRICE_TARGET'` and become effectively MANUAL after Fix #0 lands (their per-thesis EXIT triggers still fire via the trigger evaluator's 5-min cron).

---

## Done since 2026-05-08 (GAPS cleanup — verified against merged code)

Doc-only pass. The product owner asked for an honest re-grade of the open items after spot-checking the actually-merged code (not just session summaries). Two items moved to closed; the P0-5 umbrella was rewritten in plain English; P0-5e was downgraded from P0 to P1.

- ✅ **P1-4 — Discovery softer than required at minting.** Closed as already-done. Verified Step 4 of [`lib/agent/system-prompt.ts`](../lib/agent/system-prompt.ts) on main (after PR #235 + PR #239): explicitly says use `record_thesis`, not `manage_watchlist`, with three conviction bands (high → ACTIVE+place_trade, lower → WATCHING with ENTER triggers, fails → PASS thesis). Explicit framing: *"Open slots are the reason discovery should run, not a reason to skip it."* The original GAPS framing ("the prompt says 'add to watchlist'") predates these PRs. No code change in this cleanup — just GAPS.md acknowledging the prompt is already where the audit wanted it.
- ✅ **P0-5 umbrella reframed.** "Mostly cosmetic" was true on 2026-05-07 audit but stale after PR #239 closed P0-5a + most of P0-5c. Rewrote the section in plain English: the umbrella problem is "operational layers between morning runs are still horizon-blind." P0-5b (cron-side wiring of `horizon-policy.ts`) is the real remaining P0; P0-5c is a 30-min prompt-edit follow-on; P0-5e was downgraded from P0 to P1 because it's a prompt fix (per-horizon tool-selection guidance), not a code change.

**No code changes** in this PR — pure GAPS.md honesty. The "open items" list now accurately reflects what's actually missing in `origin/main`.

---

## Done since 2026-05-08 (Thesis Architecture)

End-to-end thesis-system pass. PR [#239](https://github.com/dave-sucks/hindsight/pull/239). Live reference: [`docs/THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md).

- ✅ **P0-1 — Structural-belief fields required.** New [`lib/agent/thesis-belief.ts`](../lib/agent/thesis-belief.ts) validator (mirrors `thesis-shape.ts`). `record_thesis` rejects directional theses missing `core_belief` (non-empty after trim), ≥2 `key_assumptions`, ≥2 `invalidation_conditions`. `update_thesis` adds `structural_unchanged_reason` + discipline gate: patches that change `confidence_score` / `target_price` / `stop_loss` without touching belief AND without an explicit reason are rejected (gate bypasses on terminal transitions and ACTIVE promotions). Reason persists into the timeline rationale. 14 unit tests; closes the 32%/32%/38% population gap audited 2026-05-07.
- ✅ **P0-5a — Horizon + structural belief surfaced in daily-run prompt.** [`run-input.ts`](../lib/agent/run-input.ts) `activeTheses` select now carries `horizon`, `coreBelief`, `nextReviewAt`, `catalystDate`, `maxHoldDays`. [`system-prompt.ts`](../lib/agent/system-prompt.ts) Live Theses table renders Horizon + Schedule columns (review-due / catalyst-in-Nd / max-hold-Xd-left), plus per-thesis line: belief preview + horizon exit-policy hint sourced from [`lib/agent/horizon-policy.ts`](../lib/agent/horizon-policy.ts). Agent no longer needs a `get_theses` round-trip to remember what kind of trade it's managing.
- ✅ **Promotion gap — `change_status: "ACTIVE"` enum extension.** Pre-this-PR the tactical prompt instructed `update_thesis(change_status: "ACTIVE")` but the enum only allowed INVALIDATED/CLOSED. Calls rejected silently; theses stayed WATCHING with open positions, breaking the morning-run Live Theses table. Now legal: requires `existing.status === "WATCHING"` and recomputed `target_price` + `stop_loss` (the WATCHING target was the ENTER trigger level — behind us at promotion). Bypasses the goalpost-moving guard (legitimate target raise on promotion) and the structural-unchanged-reason gate (promotion is its own justification — capital behind existing belief). Tactical + daily prompts updated to use the new path.
- ✅ **Conditional requireds — `catalystDate` when CATALYST, explicit `maxHoldDays` when TRADE.** `record_thesis` rejects `horizon=CATALYST` without `catalyst_date` (the dated event drives both the trigger template and the 30d-past-event exit policy) and `horizon=TRADE` without explicit `max_hold_days` (no more silent default-14 auto-extending past the intended window). PASS theses bypass.
- ✅ **Trade evaluator reads the belief.** [`trade-evaluator.ts`](../lib/inngest/functions/trade-evaluator.ts) post-mortem prompt now feeds `coreBelief` + `keyAssumptions` + `invalidationConds` + `horizon` into GPT-4o. System prompt instructs grading against the BELIEF, not just the rationale: "right outcome, wrong reasons" becomes a documentable learning. Closes the eval side of P0-1.
- ✅ **`horizon-policy.ts` — single source for horizon constants.** New module exports `HORIZON_REVIEW_DAYS`, `HORIZON_REVIEW_CADENCE`, `HORIZON_EXIT_POLICY`. `record_thesis` imports the day constants for `nextReviewAt` math (replacing inline 1/1/7/30 ternary). Daily-run prompt imports the cadence + policy strings for per-thesis hint rendering. Writer and reader stay aligned.
- ✅ **Drive-by — `update-thesis.ts` `select` was missing `direction` + `entryPrice`.** Latent bug in the shape gate (it referenced fields the Prisma client returned as undefined at runtime). Added to the select.

**Verification 2026-05-08:**
- `npx tsc --noEmit` clean for all modified files. Two pre-existing unrelated errors (`GenerateAudioButton.tsx`, `transcript-row.tsx`) remain.
- 168/168 jest tests pass (14 new in `thesis-belief.test.ts`; 154 existing across 7 suites).
- **Pending:** next morning cron — watch for rejection-loop behavior on the new gates. If thesis mint count drops to ~0 the prompt didn't fully adapt; revert + tighten before re-shipping. Spot-check via Supabase: `SELECT direction, coreBelief IS NOT NULL, array_length(keyAssumptions,1), array_length(invalidationConds,1) FROM "Thesis" WHERE createdAt::date = current_date AND direction IN ('LONG','SHORT')`.

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
