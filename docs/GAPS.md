# Hindsight — Gaps

> **What this is:** open items and recent-done trajectory for the **thesis architecture rework**. Scoped: this is the tracker for the multi-PR effort to get the durable-thesis system tight (discovery → watching → trigger → tactical → daily-run review → action). Not a general bug tracker.
>
> **Where things go:**
> - Open item on the thesis rework → here.
> - Code smell / fragility outside the rework → [`TECH_DEBT.md`](./TECH_DEBT.md).
> - "What shipped in PR #X?" → GitHub PRs (search by label or date).
> - Product north star → [`VISION.md`](./VISION.md).
> - Live thesis-system reference → [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md).
> - Big multi-PR plans → `docs/plans/<NAME>.md` (e.g., [`plans/MORNING_RUN_V2_DESIGN.md`](./plans/MORNING_RUN_V2_DESIGN.md)).
>
> **How to use it:** start at P0. P0s block the rework's correctness. P1s degrade quality. P2s are papercuts but still part of the rework. Don't skip levels. When something closes, **move it** to a "Done since" section below, not strike-through inline.
>
> **Most recent major movement:** 2026-05-25 PROMOTED-integration wave + doc cleanup. The PROMOTED-status work shipped end-to-end across three PRs: PR #330 (promotion fan-out + synthesis-prompt PROMOTED context — closes P0-13 Holes #1, #2), PR #331 (read-side: deep-research excerpt + `researchAge` surfaced to decision agents), PR #333 (PROMOTED-aware trigger templates — closes P1-21 / P0-13 Hole #4). P0-13's last open piece — Hole #3, the `place_trade` staleness gate — is re-filed as P1-22 below and deferred to Phase 2 of `THESIS_LIFECYCLE_FIX.md`. Same-day cleanup audit retired four stale entries: P0-10 (immediate failure mode structurally impossible post-PR #265; deeper concern rolls into P1-20), P1-14 (V1 prompt path is dead — `buildV2SystemPrompt` deprecated with zero callers; PR #317 dropped the `useV2Prompt` column), P2-19 (PR #313 merged 2026-05-23). New P2-23 filed for `parentThesisId` deprecation (one writer, four readers, no chain walking — redundant with `ThesisUpdate`). Prior wave (2026-05-23): P0-12 narration→execution gate moved to end-of-run — see "Done since 2026-05-23" in `GAPS_HISTORY.md`.

---

## Production data snapshot — the numbers driving this list

These numbers are the empirical baseline for the gaps below. Re-run the queries in `ARCHITECTURE_DEEP_AUDIT.md` (legacy) to refresh.

> **Note (2026-05-23):** the tables below reflect a 7-analyst roster; Intraday Momentum Scalper has since been deleted (current roster: 5 analysts — Catalyst Event Raider, Earnings Drift Trader, EV Catalyst Event Trader, Secular Theme Architect, Tech Momentum Trader). Dated rows are kept as historical evidence; re-running the queries today will return a different shape.

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

*(P0-12 closed 2026-05-23 — moved to `GAPS_HISTORY.md`. Fix: narration→execution gate moved from `record_run_summary` (mid-run, marked FAILED) to `complete_run` preflight (end-of-run, soft refusal). Self-corrected runs pass; truly missing tool calls get a recoverable refusal.)*

*(P0-10 closed 2026-05-25 — moved to `GAPS_HISTORY.md`. Immediate failure mode (4 zombie theses on AMD/AVGO/GOOGL/TSM) is structurally impossible post-PR #265's atomic WATCHING→ACTIVE flip in `place_trade`. The deeper architectural concern — `reasoningSummary` free text overriding structured `status` in the agent's reasoning — is now captured by **P1-20** below, which proposes removing `status` as a settable arg entirely. P0-10 rolls into that refactor.)*

*(P0-11 closed 2026-05-16 via PR #270 — moved to `GAPS_HISTORY.md`. P0-5 closed across PRs #239 + Morning-Run-V2 + 2026-05-13 — moved to `GAPS_HISTORY.md`.)*

*(P0-13 closed 2026-05-25 — moved to `GAPS_HISTORY.md`. Hole #1 (PROMOTED context in synthesis prompt) + Hole #2 (promotion fan-out) shipped via PR #330; Hole #4 (PROMOTED triggers) shipped via PR #333. Hole #3 (place_trade staleness gate) deferred to Phase 2 of `docs/plans/THESIS_LIFECYCLE_FIX.md` and re-filed as **P1-22** below.)*

---

## P1 — Quality is degraded but system functions

*(P1-4 closed via PRs #235 + #239. P1-13 closed 2026-05-19. P1-16 closed 2026-05-19. **P1-18 closed via PR #316 (2026-05-23).** All moved to `GAPS_HISTORY.md`.)*

### P1-19 — PRINCIPAL_CHAT hangs when child THESIS_WRITER fails
**Source:** Handoff item #7 from 2026-05-20 tactical session. Observed 2026-05-19: Tech Momentum's PRINCIPAL_CHAT was stuck `status=RUNNING` for 44+ minutes because its child THESIS_WRITER failed at 10s on an Anthropic rate-limit error and the parent was never notified.

The PRINCIPAL_CHAT path uses Inngest's `step.invoke()` to spawn THESIS_WRITER. When the child errors at the API boundary (rate-limit, timeout, etc.), the invoke promise doesn't reject in the parent's step — it sits open. Parent eventually hits wall-clock timeout, leaves a zombie RUNNING row.

**Same observability shape as P1-12** (Earnings Drift silent timeout) but in a different code path (parent/child agent invocation rather than top-level model call).

**Fix path:** instrument `step.invoke()` call site in PRINCIPAL_CHAT — wrap in try/catch with explicit timeout. If the child fails, write a synthetic error event to the parent's RunEvent stream and mark parent FAILED with a clear error message. Mirror the same finalizer wall-clock pattern as #287 (THESIS_WRITER's own try/catch wrap). ~1-2 hours.

### P1-11 — Quote source inconsistency between Layer-2 and Layer-1
**Source:** Code audit 2026-05-13.

`get_theses.needsAction` (Layer 2) fetches prices via `getLatestPrices` from Alpaca. `complete_run` preflight (Layer 1, PR #266) fetches via `getStockQuote` from Finnhub. For a ticker at the boundary of an ENTER trigger, the two can disagree by tens of cents — enough to flip `TRIGGER_MATCHING_NOW` vs `null`.

Failure scenario: agent reads `get_theses`, sees GOOGL with `needs_action: null`, skips it. Agent calls `complete_run`. Preflight re-checks with Finnhub, gets a different price, computes `TRIGGER_MATCHING_NOW`, refuses. Agent has no path forward — Layer 2 told it nothing was needed, Layer 1 says something is. Cryptic refusal loop.

**Fix path:** single-source the quotes. Either both use Alpaca or both use Finnhub. The trigger-evaluator cron's price source is the canonical one — both `get_theses` and `complete_run` preflight should match it.

### P1-12 — Earnings Drift Trader silent timeout (undiagnosed)
**Source:** 2026-05-12 morning cron.

Run produced 0 tool calls in 241s, then timed out. No RunMessage rows, no RunEvent rows. Same shape as 2026-05-11 silence. Did not recur 2026-05-13 (20 tool calls, clean). The zero-tool-call recovery in PR #261 fires only on caught exceptions; a silent OpenAI hang that runs out the wall clock doesn't trip it.

**Hypothesis:** this analyst's injected context (sectors, ticker count, position count, latest briefing length) produces an unusually large system prompt. Could be a token-budget edge or an OpenAI-side latency cliff specific to long inputs.

**Fix path:** instrument system-prompt length at run start. Log it. If Earnings Drift is meaningfully larger than the other 5 analysts, that's the smoking gun. If it isn't, file as transient and add a wall-clock-triggered retry separate from the catch-path retry.

*(P1-14 closed 2026-05-25 — moved to `GAPS_HISTORY.md`. The V1 prompt path is dead: `buildV2SystemPrompt` (the legacy/misnamed V1 builder in `lib/agent/system-prompt.ts`) is marked `@deprecated` with zero callers; both `app/api/agent/[mode]/route.ts` (manual UI runs) and `lib/inngest/functions/morning-research.ts` (cron) unconditionally call `buildDailyRunSystemPromptV2`; the `useV2Prompt` column was dropped from `AgentConfig` (P2-17, PR #317). V2's "needsAction == null → skip" is the official and only rule, enforced at the tool layer by `complete_run`'s preflight (PR #266 / PR #320).)*

### P1-9 — Discovery prompt is archetype-blind (biggest remaining item)
**Source:** Discovery review 2026-05-11 (see `DISCOVERY_REVIEW.md`). The 4-dimension scoring rubric (trendStrength / relativeStrength / entryQuality / catalystFreshness) is calibrated for momentum/breakout playbooks and applied universally. A Deep Value Contrarian buys downtrends — `trendStrength: 3` is a SELL signal for them. An Insider Cluster Buying archetype has no slot in the rubric for Form 4 cluster patterns. Catalyst Event Trader / Earnings Drift should weight earnings_calendar heavily; momentum scoring barely.

**Fix path:** branch the discovery prompt into three families — EVENT_DRIVEN (Earnings Drift, Catalyst Event), MOMENTUM (Momentum Breakout, Mean Reversion, Sector Rotation, Unusual Options), FUNDAMENTAL (Deep Value, Thematic Secular, Insider Cluster) — each with a tuned scoring rubric and primary source priority. Requires either an `AgentConfig.archetypeId` column or runtime classification from analystPrompt + holdDurations. Full spec in `DISCOVERY_REVIEW.md` § Proposed redesign. ~1 session of work.


### P1-15 — Provenance soft-gate: agents use WEB_SEARCH despite signals existing
**Source:** Discovery runs cmp4m0q35 (3 mints) + cmp698wva (16 mints) — every mint had `sourceKind: "WEB_SEARCH"` even when `read_signals` returned matching signals for the ticker. `record-thesis.ts` lines 414-444 detect the mismatch and log a console warning, but don't reject the write. Net effect: `sourceSignalIds` is empty, so the trade-evaluator's Monitor ROI tracer (VISION Pillar 5) can't walk `Thesis.sourceSignalIds → Signal.monitorId → Monitor` to credit which monitor produced the win/loss on close. The whole monitor-ROI flywheel is broken.

**Fix path:** promote the nudge to a hard reject when `ctx.signalsByTicker[ticker]` has signals AND the agent passed non-ROUTED_SIGNAL provenance. Forces the agent to cite signal IDs. ~30 minutes in `lib/agent/tools/record-thesis.ts`.


### P1-17 — Possibly polluted historical "discovery" runs (informational, no code fix)
**Source:** PR #275 surfaced the dueling-agents bug — opening a discovery run page while it was `status=RUNNING` auto-spawned a second agent against `/api/agent/research-run` (daily-run prompt + allowlist) that competed with the real discovery agent. Discovery runs prior to PR #275 where the user opened the page mid-run may have written `RunMessage` from the daily-run agent rather than the discovery agent. The minted `Thesis` rows are real DB writes either way, but the AGENT BEHAVIOR audited in those runs may not have been the discovery agent. Affects audit credibility for runs: cmp4m0q35 (Tech Momentum, 3 mints), cmp698wva (Tech Momentum, 16 mints), cmp6bryy (Secular Theme, 10 mints), cmp6dk0w1 (Secular Theme, 0 mints — confirmed dueling).

**No fix:** historical data is what it is. Post-#275 runs are clean. Listed here so future audits don't over-index on pre-#275 discovery transcripts.


### P1-20 — Thesis status should be derived from actions, not a manual arg with clamps
**Source:** Surfaced 2026-05-23 during PR #316 (Phase 1 stabilization). Cross-ref: **P1-18 (closed via PR #316) and this entry (the architectural followup)** were two passes at the same underlying issue — #316 patched the chat-dispatch surface with a third clamp, P1-20 proposes removing the surface that needs clamping.

The $MU zombie thesis (cmpetjrw5...) — minted ACTIVE with 10 HELD-template triggers but no Alpaca position — was the trigger for this insight. PR #316 patches the immediate failure with a third clamp (`forceWatchingMint` for chat dispatches, mirroring the existing `discoveryOnly` clamp). The clamps work but they're treating the symptom. The structural issue is that `record_thesis` exposes `status` as a settable arg with `ACTIVE` as the default fallback, so every new dispatch surface (Phase 3 daily promote-to-active, Phase 4 tactical inline calls) will need its own clamp or it'll mint zombies the same way.

**The right invariant:** status is a function of ACTIONS, not a manual field. Only three legal write paths:

| State | Set by | When |
|---|---|---|
| WATCHING | `record_thesis` | Always, for LONG/SHORT mints. No exceptions, no arg. |
| ARCHIVED | `record_thesis` | Always, for PASS mints. Terminal-at-write institutional memory. |
| ACTIVE | `place_trade` | Atomically in the same tx as the Alpaca position open. Already wired this way per PR #265 — just need to remove the other paths. |
| CLOSED | `close_position` | Atomically with the Alpaca position close. |
| INVALIDATED | `update_thesis(change_status='INVALIDATED')` | The thesis is now disproven. Allowed from WATCHING freely; allowed from ACTIVE only if `close_position` fired in the same run (existing zombie-position guard). |
| ARCHIVED (post-mint) | `update_thesis(change_status='ARCHIVED')` | "Stop watching this name." Allowed from WATCHING freely; allowed from ACTIVE only if `close_position` fired in the same run. |

`update_thesis` is CONTENT-only: numbers, belief, assumptions, target, stop, scoring, rationale. The only legal direction edit is `PENDING → LONG/SHORT/PASS` (commit a user-seeded watchlist add to a real thesis). Status is never set by update_thesis except for the two narrow terminal transitions above.

**Why this is better than clamps:**
1. **Zombie minting becomes structurally impossible.** Agent literally cannot pass `status='ACTIVE'` to record_thesis because the arg doesn't exist.
2. **No clamp creep.** Phase 3 daily and Phase 4 tactical don't need their own clamps. The path doesn't exist to need clamping.
3. **The agent prompt simplifies.** All the "DEFAULT TO WATCHING…", "discovery mints WATCHING…", "the clamp will downgrade…" instructions in `record-thesis.ts`, `system-prompts/discovery.ts`, `run-thesis-writer.ts` collapse into one sentence: "record_thesis writes WATCHING. To trade, call place_trade."
4. **HELD-template triggers are guaranteed paired with positions** because both attach inside `place_trade.ts`'s atomic block (already true per PR #265).

**Fix path (estimated 1 focused day):**
1. **`record_thesis` schema** — drop the `status` arg entirely. Hard-code: LONG/SHORT → WATCHING, PASS → ARCHIVED. Delete the `discoveryOnly` clamp and the `forceWatchingMint` clamp (PR #316) — both become unreachable.
2. **`update_thesis` schema** — narrow `change_status` to `INVALIDATED | ARCHIVED | CLOSED` only (no `ACTIVE`). Keep the existing zombie-position guard.
3. **`place_trade`** — verify it's the sole WATCHING → ACTIVE path. Per PR #265 it should be; check for any other code path that flips status without place_trade pairing.
4. **`close_position`** — verify it's the sole ACTIVE → CLOSED path. Per the existing schema, looks fine.
5. **`tactical-run.ts`** — find any `update_thesis(change_status='ACTIVE')` calls and replace with direct `place_trade` calls (the atomic flip happens inside place_trade per #265). Delete the manual fallback.
6. **Migration / cleanup query** — audit DB for any other ACTIVE-without-position rows (the generalized $MU fix). Run same SQL pattern: flip to WATCHING, strip HELD triggers, write ThesisUpdate audit row.
7. **Prompt cleanup** — delete the "default to WATCHING / forceWatchingMint will clamp / discovery clamps to WATCHING" instructions from `record-thesis.ts` schema doc, `system-prompts/discovery.ts`, `lib/agent/run-thesis-writer.ts`'s `buildThesisWriterSystemPrompt`. Replace with one line: "Thesis creation = WATCHING. Use place_trade to enter a position (it flips status atomically)."
8. **Test coverage** — add tests that record_thesis cannot produce ACTIVE; that update_thesis cannot transition to ACTIVE; that place_trade is the only path; that ACTIVE rows always have a paired open Position.

**When to fire:** AFTER PR #316 lands and Phase 1 is confirmed stable in production for ~3-5 trading days. The clamps in #316 close the immediate zombie risk; this refactor closes the structural risk before Phase 2 Discovery fan-out adds a third dispatcher (Discovery already has its own clamp via `discoveryOnly`; the refactor still simplifies it).

**Cross-references:** PR #316 (clamp landing), PR #265 (atomic place_trade WATCHING → ACTIVE), PR #270 (F2 zombie-position guard on update_thesis ARCHIVED — model for the narrowed INVALIDATED + ARCHIVED transitions on this refactor).

*(P1-21 closed 2026-05-24 — moved to `GAPS_HISTORY.md`. Fix: `ThesisState` enum extended to include `PROMOTED`; template builder delegates PROMOTED to the WATCHING template family (no EXIT, ENTER + REVIEW only); `transitionThesisToPromoted` regenerates triggers against the PROMOTED template in the same tx as the status flip; `close_position` refuses cleanly on PROMOTED status; retro-script `scripts/strip-promoted-orphan-exit-triggers.ts` for any pre-fix PROMOTED rows.)*

**Update 2026-05-25:** addressed by [PR #333](https://github.com/dave-sucks/hindsight/pull/333) — open, not yet merged. Mark as closed when #333 merges.

### P1-22 — `place_trade` Layer-1 staleness gate on research age (Hole #3 from P0-13)
**Source:** Re-filed 2026-05-25 from P0-13 close-out. PR #330 explicitly pulled this hole out of scope ("I prototyped it in this session and pulled it back out — the gate's recovery instruction `call dispatch_thesis_research(mode:'refresh')` requires that tool to be in the daily/tactical allowlists, which it isn't today").

A PROMOTED thesis (or any thesis with stale research) can still be traded via `place_trade` without a refresh. Today's daily-run agent reads `researchAge` (surfaced by PR #331) but the read is advisory — no Layer-1 gate refuses a trade on `researchUpdatedAt > 7d`. So an agent that ignores the freshness signal can still put real live money on stale research.

**Fix path:** ship as part of Phase 2 of `docs/plans/THESIS_LIFECYCLE_FIX.md`. Two coupled changes:
1. Add `dispatch_thesis_research` to the daily-run + tactical mode allowlists so the recovery instruction is real.
2. Add a Layer-1 refusal in `place_trade` when `researchUpdatedAt` is older than a configurable threshold (7d for tactical, 14d for daily) AND no in-run `dispatch_thesis_research(refresh)` call landed. Refusal message names the recovery tool by name.

**When to fire:** after first analyst promotion lands cleanly and we have at least one production data point on how often PROMOTED theses are traded with stale research. The recovery loop ("agent reads age → calls refresh → waits → trades") needs the allowlist changes to even be possible, so this is gated on Phase 2 starting.

**Cross-references:** `docs/plans/THESIS_LIFECYCLE_FIX.md` Phase 2, PR #330 (the producer-side fan-out this depends on), PR #331 (the read-side surfacing this validates against), `docs/plans/THESIS_RESEARCH_V2.md` §8 Phase 3 (the original spec).

---

## P2 architecture cleanups — surfaced 2026-05-15

### P2-13 — `record_run_summary` `ranked_picks` should be server-derived
**Source:** `THESIS_ARCHITECTURE.md §11` specifies the 5 run-summary buckets (Added / Researched-passed / Promoted / Removed / Closed) as **server-derived from `ThesisUpdate WHERE runId = X`**. Today the tool requires the agent to pass `ranked_picks` manually, duplicating work and creating drift between the audit log and the displayed summary. Discovery run summaries usually only populate buckets 1+2 — easy candidate to derive.

**Fix path:** change `record_run_summary` to accept only `primary_decision` + `decision_rationale`; derive `ranked_picks` server-side from ThesisUpdate joins. Update the discovery + daily-run prompts to stop telling the agent to enumerate. ~1 hour.


### P2-14 — `get_market_movers` + `get_earnings_calendar` don't honor `ctx.feeds`
**Source:** Architecture review 2026-05-13. If an analyst's `AgentConfig.feeds` includes `MARKET_MOVERS_GAINERS`, the same data already arrives via `read_signals` as a routed aggregate signal. Calling `get_market_movers` directly does a redundant FMP pull. Should detect subscription and either skip the pull or return a "you already have this via read_signals" pointer.

**Fix path:** in each tool, check `ctx.feeds` against the corresponding FEEDS enum value and short-circuit if subscribed. ~20 minutes each.


### P2-15 — TSEM-class `get_stock_data` field staleness
**Source:** Discovery run cmp4m0q35 minted TSEM with `entryPrice: $270.77` and `high52w: $232.67` — current price above 52-week high, which is impossible. Either the price feed returned wrong data, the 52w-high field is stale (cached from before today's high), or the fields come from different endpoints with different freshness. Affects every analyst since the agent uses both to set targets.

**Fix path:** trace the two fields back to their providers (likely Finnhub for quote + Finnhub or FMP for 52w range). Add a same-call freshness guarantee or a sanity-check that rejects price > high52w in the tool layer. ~1 hour to diagnose, ~1 hour to fix.


### P2-16 — Consider collapsing INVALIDATED + ARCHIVED into one terminal status
**Source:** Architecture review 2026-05-16 after F2-extension PR #270. Of the four terminal statuses (CLOSED / INVALIDATED / ARCHIVED / SUPERSEDED), the INVALIDATED vs ARCHIVED distinction is thin:

- INVALIDATED = "evidence broke the view" (uses `invalidReason` field)
- ARCHIVED = "walked away without evidence-driven view-break" (uses `closeReason` field)

Both mean "terminal without a clean trade outcome." The narrative ("evidence" vs "walk-away") lives in the rationale text either way. The F2 gate (PR #270) had to treat both identically against zombie positions — if they're functionally identical for safety guards, they're a foot-gun for being separate. The AMZN zombie on Catalyst Event Raider (2026-05-14) was created via the ARCHIVED-on-ACTIVE-with-position path that F2 originally didn't cover.

**Fix path:** collapse into a single terminal status (call it `TERMINATED` or keep `INVALIDATED` and migrate ARCHIVED→INVALIDATED + rename `closeReason` field usage). Update every query that filters on `status IN (...)` to know the new shape. Update the five-bucket run summary derivation in `record_run_summary`. ~15-20 files. Not blocking; revisit once we have more data on whether the distinction provides analytics value or keeps biting.


*(P2-17 closed 2026-05-23 — `useV2Prompt` column dropped from AgentConfig + schema, dead comment removed from `morning-research.ts`. Moved to `GAPS_HISTORY.md`.)*


### ~~P2-18 — Catalyst Event Raider near-no-op morning runs~~
**CLOSED 2026-05-21** by PR #310's `needs-action` 24h look-ahead. Root cause traced to a timing gap: Catalyst's WATCHING theses had `nextReviewAt` set for ~09:30 ET (set by discovery cron on Sundays at 09:00 ET); the daily morning run at 08:00 ET saw them as "not yet due" (strict `< now` check) and skipped. The trigger evaluator's REVIEW_DATE_HIT cron at 09:31 ET then fired a tactical run for each, producing redundant work the morning agent could have done.

**Production proof, 2026-05-21:** Catalyst 0% focus → 42.9% focus, 5 tool calls → 16, 2 trades placed (MRVL + OKTA — first ACTIVE positions ever for this analyst). The 24h look-ahead in `needs-action.ts:218-242` was the single change.

See `GAPS_HISTORY.md` "Done since 2026-05-20" for the full block.


*(P2-19 closed 2026-05-23 via PR #313 — moved to `GAPS_HISTORY.md`. Parent rows now forward the full thesis data into `<ThesisSheet>` instead of cherry-picking 10 props; the skeleton-then-fetch UX gap on watchlist/stock/trade sheet opens is gone.)*

### P2-20 — Volume ratio math broken for intraday timestamps (durable fix for the #307 workaround)
**Source:** Follow-up from 2026-05-20 tactical volume gate work (PR #307).

`lib/agent/tools/get-stock-data.ts:166` computes `volumeRatio = today's_accumulated_volume / 20-day_avg_daily_volume`. At 09:45 ET (15 min after open), the accumulated number is mechanically small even when intraday-volume-pace would annualize to >1.5x daily. PR #307 sidestepped this at the prompt layer by gating the volume check on horizon + time-of-day (only TRADE horizon faces the gate, and only after 14:00 ET).

The durable fix is tool-layer: expose a `volumeRatioTimeOfDayAdjusted` field that does `accumulated_volume / expected_at_this_hour_of_20d_avg`. Then the agent can read a number that means "is volume on pace to be exceptional" instead of doing broken raw-ratio math.

**Why P2:** #307's workaround handles the high-impact cases. The math fix matters most for TRADE-horizon tactical fires between 14:00-16:00 ET on modestly-elevated days (the only remaining window where the raw ratio is used). Low frequency, manageable.

**Fix path:** add the field in `get-stock-data.ts:138-179` candle/technicals block. Update intraday-tactical.ts:210 to read the new field instead of the raw one. Remove the time-of-day clause from the prompt once the tool returns a self-correcting number. ~1-2 hours.

*(P2-21 closed 2026-05-23 — `predev` script added to `package.json`. `npm run dev` now regens the Prisma client before booting. Note: `npx tsx scripts/foo.ts` still bypasses (it doesn't trigger npm pre-hooks); convention for repair scripts is run `npx prisma generate` first or use `npm run dev` once before the script. Moved to `GAPS_HISTORY.md`.)*

### P2-22 — Cross-analyst discovery duplication
**Source:** 2026-05-17 discovery cron. **Four** analysts independently added AMBA on the same Sunday; same for POET, MDB, ZS, SNOW, OKTA. Audit doc A8; handoff item #6.

The Universe fences don't differentiate analyst strategies enough — multiple analysts whose configs allow Semiconductor-cap-mid-AI-Infrastructure (i.e. most of them) end up picking the same names from the same routed signals. Each analyst minted its own WATCHING thesis for AMBA, with similar entry triggers around $145-$148. Net result: 4 thesis rows for the same name with nearly-identical setups, 4x the trigger evaluator work, 4x the tactical-run noise when AMBA moves.

**Why P2:** affects book quality + tactical noise more than trading correctness. Once #311's discovery cap of 5 is in place (it is), the symptom is bounded — but it's still wasteful. Lower-priority than the action-layer fixes that just shipped.

**Fix path:** add a router-side "already-covered-by-peer-analyst-this-session" check during discovery cron. If analyst-A already minted AMBA today, analyst-B's prompt sees a hint "AMBA already in another analyst's discovery this week — skip unless your edge is meaningfully different." Could also enforce at the record_thesis layer (refuse the Nth mint of the same ticker across all analysts in the same Sunday session). ~1-2 hours.


### P2-23 — Deprecate `parentThesisId` (the direction-flip pointer is now redundant with ThesisUpdate)
**Source:** Audit 2026-05-25. The user noticed the "thesis parent" concept feels stale now that theses are mutable across their lifetime instead of immutable per-run records.

`Thesis.parentThesisId` was designed as the audit-chain pointer for direction flips: when `record_thesis(parent_thesis_id, direction='SHORT')` mints a new SHORT thesis on a ticker the analyst was previously LONG on, the new row points at the old row and the old row is marked SUPERSEDED. The chain is the audit trail across direction flips.

That role is now **fully redundant** with `ThesisUpdate`. The 2026-04-26 thesis-lifecycle migration made thesis rows mutable; every state change writes a `ThesisUpdate` row capturing `priceAtTime / summary / rationale / type='SUPERSEDED'`. The direction-flip narrative lives in the audit log; the parent pointer is duplicative.

Current production footprint (verified by code audit, not DB query):
- **One writer:** `lib/agent/tools/record-thesis.ts:1368` (only fires on direction flips, which are rare in practice).
- **Four readers:** `lib/agent/tools/get-theses.ts:220`, `lib/agent/thesis-sheet-state.ts:174`, `app/api/theses/[id]/triggers/route.ts:84`, `components/agent/sheets/ThesisSheet.tsx:1343` (renders a single "Replaces #..." chip — that's the entire UI surface).
- **No chain walking anywhere.** Nothing iterates `parent → parent.parent → ...`. The pointer is a one-hop badge.

**Fix path (recommended phased, low-risk):**
1. **Phase A — stop writing.** Update `record_thesis` to no longer populate `parentThesisId` on direction flips (still write the SUPERSEDED `ThesisUpdate` audit row + the optional `parent_thesis_id` arg becomes a no-op, log + warn). UI badge becomes empty on new flips. ~30min.
2. **Phase B — drop the UI badge** (`ThesisSheet.tsx:475-492`) once Phase A has run for ~30 days with no user-reported regressions. Production direction flips are rare; the badge's loss is minor.
3. **Phase C — schema drop.** `ALTER TABLE "Thesis" DROP COLUMN "parentThesisId"` + remove the four select sites + drop the Prisma field. Defer until Q4 2026 — outside the rework's active window.

**Why P2:** zero correctness impact; pure schema/concept hygiene. The field is dormant in spirit and the chain semantic confuses new readers of the architecture doc. Worth closing for clarity, not urgency.

**Cross-references:** `docs/THESIS_ARCHITECTURE.md §3` (the canonical description of the chain — will need a §12 "Done since" note when this lands), Scenario H + Scenario B (the two scenarios that describe parent-pointer use today).

---

## P2 — Paper cuts and FE polish

### P2-4 — No DAY horizon (decision deferred — no day-trader in current roster)
SESSION_AUDIT items 33-35. Intraday Momentum Scalper was the original use-case but the analyst was deleted 2026-05-23, leaving no day-trader in the roster. The intended pattern if one is reintroduced: `horizon: "TRADE"` (14d max) + EOD-flatten cron for no-overnight enforcement. Revisit whether DAY needs to be a first-class horizon when/if a day-trader analyst is added back. ~1 day if adding the horizon.


### P2-7 — Intelligence pipeline crons are independent
Crons run on independent schedules — no Inngest `.after()` or `.waitFor()` between firm-market-sweep → portfolio-watchlist-monitor → domain-monitor → signal-router. If one lags, downstream still fires on schedule with stale data. Today this is theoretical; flag it as a known fragility. ~2 hours to add chaining. Largely mitigated by P1-10's event-emission (signals get routed immediately when each producer finishes), but the cron-schedule ordering isn't itself enforced.


*(P2-12 closed 2026-05-13 by the watchlist collapse — moved to `GAPS_HISTORY.md`.)*

---
---

## History — closed items

Trajectory of the thesis architecture rework's closed items lives in [`GAPS_HISTORY.md`](./GAPS_HISTORY.md). When a P-item closes here, move it there with the PR number. Don't keep dual copies.


## Cancelled

Items deliberately not pursued. Recorded so future sessions don't re-add them.

- ❌ **P2-6 — Thesis sheet UI items** (cancelled by user 2026-05-08). The thesis-sheet redesign as scoped (sentence-style status pill, exit-policy explanation on horizon, proximity-to-fire trigger chips, "edited in this run" activity-log call-outs, Plan section, horizon override control, days-held progress, overdue-review red flag, run-detail "Why these tickers?" panel) is not being pursued in its current form. Individual sub-pieces may resurface as their own scoped gaps if they become load-bearing for the daily loop, but the bundled redesign is shelved.

---

## How to keep this doc honest

1. When a fix lands, move the item to "Done since" with the PR number.
2. When a new gap is found, add it to the right priority section (don't dump everything in P2).
3. When the production-data snapshot is more than 7 days old, re-run the queries.
4. When the workflow page diverges from this doc, **the workflow page is right** — update GAPS.md to match. The page is the source of current state; this doc is a delta against the vision.
