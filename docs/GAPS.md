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
> **Most recent major movement:** Post-2026-05-20 wave — the keystone "no trades in 12 days" fixes shipped together with the supporting hygiene work. PRs #307 (tactical volume gate horizon-conditional), #308 (husky Prisma regen), #309 (WATCHING cadence), #310 (REVIEW_DUE 24h look-ahead + REVIEW_DATE_HIT strip), #311 (discovery Layer-1 cap of 5). Repair scripts run 2026-05-23 (33 cadences + 27 REVIEW_DATE_HIT triggers stripped). Resolved P2-18 in flight. See "Done since 2026-05-20" in `GAPS_HISTORY.md` for the full block. Surfaced and filed: P0-12, P1-18, P1-19, P2-20, P2-21, P2-22.

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

### P0-12 — Narration→execution gap on `close_position` (escalating frequency)
**Source:** 2026-05-20 EV Catalyst (ON), 2026-05-22 Catalyst Event Raider (MRVL twice, OKTA), 2026-05-22 Secular Theme Architect (SMTC + TRIM). Hit 1 of 7 runs on Wed; **3 of 7 runs on Fri**.

The agent narrates "I'll close $X" in prose, then proceeds to write `update_thesis` or `record_run_summary` without ever calling `close_position`. The narration→execution gate at `lib/agent/tools/record-run-summary.ts` catches the mismatch and marks the run FAILED. Same root failure shape as the daily-run prose-termination bug from 2026-05-07 (see CLAUDE.md "Prose-termination") but localized to the close-out tool calls, not the data-fetching ones.

**What it looks like in production (Catalyst 2026-05-22, retry):**
- Run starts COMPLETE, walks 5 tickers, narrates MRVL exit + OKTA exit
- Run summary's `decision_rationale` mentions "closed MRVL" + "closed OKTA"
- No `close_position` tool calls in the message stream
- Narration gate fires → run FAILED
- Positions remain OPEN. Trying again the next day reproduces the gap.

**Why this is P0:** the agents are now actually trading (post-#307 / #310 / #311) which means they're now trying to actually CLOSE positions. The narration gap blocks the close lifecycle. Position-state-vs-thesis-state desync widens every time a run fails this way — same family as P0-10, just with the polarity flipped (P0-10 was status saying WATCHING while position said OPEN; P0-12 leaves status ACTIVE while the agent meant to close).

**Hypothesis:** GPT-5.5 (the research-run model) is more verbose than GPT-4o was — narration mentions of "close" / "exit" / "sell" land in the rationale text but the model isn't following through with the tool call. Could also be a prompt-structure issue: when the V2 prompt asks for "step through every needsAction thesis," the agent may treat the per-thesis prose as the action and skip the tool call.

**Fix path options:**
- (Layer 2, prompt): tighten the V2 daily-run prompt's close-out language. Add explicit "narrating 'I'll close X' without a close_position tool call is a run failure" to the same Tool-call discipline block that already covers data tools.
- (Layer 1, gate): the current narration→execution gate flags this but the run still fails — fix is for tactical/morning agent to attempt a recovery before complete_run, not just fail the run.
- (Layer 1, retry): morning-research.ts's coverage retry could fire on this specific shape ("narrated close, no close call") and re-issue the tool call from the rationale text.

Reference: CLAUDE.md "Prose-termination after Step 1's parallel data tools" — same bug class, different trigger surface. The discipline block in `system-prompt.ts` was designed to prevent the data-tool variant; the close-out variant needs its own.

### P0-10 — Thesis structured status disagrees with `reasoningSummary` text
**Source:** GOOGL/Secular Theme failure 2026-05-13. Found in this session.

`Thesis.reasoningSummary` is free text the agent writes. `Thesis.status` is a structured enum. Today they can disagree: GOOGL's `reasoningSummary` literally said *"Entry executed within max position size limits"* while `status = WATCHING` and the matching Position row (cmowxdgx8000404jpr2bnzyg0) was OPEN since 2026-05-08. Two truths, both visible to the agent.

Concrete production state when this was diagnosed: 4 theses (AMD, AVGO, GOOGL, TSM) had open positions but `status = WATCHING`. **DB fixed 2026-05-13** (all 4 flipped to ACTIVE with the actual fill prices + 4 `ThesisUpdate` STATUS_CHANGED audit rows, IDs prefixed `mfix`). PR #265's auto-promotion in `place_trade` prevents new occurrences. But there's no guard at the tool layer that catches `reasoningSummary` text claiming actions inconsistent with structured fields.

**Why this is P0:** the agent's read of GOOGL on 2026-05-13 went exactly: see "Entry executed" in reasoningSummary → classify as portfolio-held → ignore the WATCHING-thesis-needs-action work. The free-text field overrode the structured field in the agent's reasoning because the agent reads prose first.

**Fix path:** either (a) deprecate `reasoningSummary` as a state-bearing field and require structured fields for any operational status, or (b) add a `record_thesis` / `update_thesis` validator that rejects `reasoningSummary` text containing action verbs ("executed", "opened", "closed", "trimmed") when those actions aren't reflected in structured state. (a) is cleaner but bigger.

*(P0-11 closed 2026-05-16 via PR #270 — moved to `GAPS_HISTORY.md`. P0-5 closed across PRs #239 + Morning-Run-V2 + 2026-05-13 — moved to `GAPS_HISTORY.md`.)*

---

## P1 — Quality is degraded but system functions

*(P1-4 closed via PRs #235 + #239. P1-13 closed 2026-05-19. P1-16 closed 2026-05-19. All moved to `GAPS_HISTORY.md`.)*

### P1-18 — New thesis-writer agent mints status=ACTIVE instead of WATCHING
**Source:** 2026-05-21 user-triggered MU thesis via the new deep-research builder (THESIS_RESEARCH_V2 Phase 1, PR #282). DB state after the build: `Thesis { ticker: "MU", status: ACTIVE, direction: LONG, horizon: TARGET, source: AGENT, sourceKind: USER_ADDED, coreBelief: <populated> }`. No matching Position row — classic zombie shape.

**Why this is a bug:** the rest of the system follows the rule "net-new coverage = WATCHING; ACTIVE only via place_trade promotion." Discovery mints WATCHING (PR #311 enforces a Layer-1 cap). Daily-run promotes WATCHING → ACTIVE atomically inside `place_trade` (PR #265). The user-builder pathway short-circuits both: it lets the agent set `status: ACTIVE` directly without a paired Alpaca order. Result: the same desync pattern P0-10 documented.

**Code path:** `lib/agent/run-thesis-writer.ts`. The thesis-writer agent has its own status-setting logic; it doesn't run through `record_thesis`'s discovery-direct clamp (line 722-727 in record-thesis.ts which forces WATCHING in discoveryOnly mode).

**Fix path:** mirror the discovery clamp. Treat any USER_ADDED / WEB_SEARCH / WATCHLIST_REVIEW thesis-writer mint as forced WATCHING. The user can promote to ACTIVE later via the standard place_trade path (which is what the architecture wants — a research thesis is a candidate, not a commitment). ~20 minutes.

**Existing zombie:** MU thesis row `cmpetjrw5000304jv9ybkn0c0` needs manual repair (flip to WATCHING + write a STATUS_CHANGED audit row).

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

### P1-14 — No Layer-1 closeout enforcement for `needs_action: null` theses
**Source:** Design follow-up from `docs/plans/MORNING_RUN_V2_DESIGN.md`.

The V2 prompt says *"Theses with `needsAction == null` don't need to be touched."* This is correct as designed. But the legacy V1 prompt's *"every Live Theses row produces one tool call"* contract is still present in code paths that V2 hasn't replaced (the manual run path, per P0-11; the V1 fallback prompt). Decision needed: is the V2 design's "null = skip" the official rule, or is the V1 contract still operational somewhere? Today the two coexist contradictorily.

**Fix path:** make a call. Either explicitly delete the closeout contract from V1 too (commit to "trigger system is the only source of truth"), or implement a Layer-1 check that counts ThesisUpdate rows per live thesis per run for both prompt versions.

### P1-9 — Discovery prompt is archetype-blind (biggest remaining item)
**Source:** Discovery review 2026-05-11 (see `DISCOVERY_REVIEW.md`). The 4-dimension scoring rubric (trendStrength / relativeStrength / entryQuality / catalystFreshness) is calibrated for momentum/breakout playbooks and applied universally. A Deep Value Contrarian buys downtrends — `trendStrength: 3` is a SELL signal for them. An Insider Cluster Buying archetype has no slot in the rubric for Form 4 cluster patterns. Catalyst Event Trader / Earnings Drift should weight earnings_calendar heavily; momentum scoring barely.

**Fix path:** branch the discovery prompt into three families — EVENT_DRIVEN (Earnings Drift, Catalyst Event), MOMENTUM (Momentum Breakout, Mean Reversion, Sector Rotation, Unusual Options), FUNDAMENTAL (Deep Value, Thematic Secular, Insider Cluster) — each with a tuned scoring rubric and primary source priority. Requires either an `AgentConfig.archetypeId` column or runtime classification from analystPrompt + holdDurations. Full spec in `DISCOVERY_REVIEW.md` § Proposed redesign. ~1 session of work.


### P1-15 — Provenance soft-gate: agents use WEB_SEARCH despite signals existing
**Source:** Discovery runs cmp4m0q35 (3 mints) + cmp698wva (16 mints) — every mint had `sourceKind: "WEB_SEARCH"` even when `read_signals` returned matching signals for the ticker. `record-thesis.ts` lines 414-444 detect the mismatch and log a console warning, but don't reject the write. Net effect: `sourceSignalIds` is empty, so the trade-evaluator's Monitor ROI tracer (VISION Pillar 5) can't walk `Thesis.sourceSignalIds → Signal.monitorId → Monitor` to credit which monitor produced the win/loss on close. The whole monitor-ROI flywheel is broken.

**Fix path:** promote the nudge to a hard reject when `ctx.signalsByTicker[ticker]` has signals AND the agent passed non-ROUTED_SIGNAL provenance. Forces the agent to cite signal IDs. ~30 minutes in `lib/agent/tools/record-thesis.ts`.


### P1-17 — Possibly polluted historical "discovery" runs (informational, no code fix)
**Source:** PR #275 surfaced the dueling-agents bug — opening a discovery run page while it was `status=RUNNING` auto-spawned a second agent against `/api/agent/research-run` (daily-run prompt + allowlist) that competed with the real discovery agent. Discovery runs prior to PR #275 where the user opened the page mid-run may have written `RunMessage` from the daily-run agent rather than the discovery agent. The minted `Thesis` rows are real DB writes either way, but the AGENT BEHAVIOR audited in those runs may not have been the discovery agent. Affects audit credibility for runs: cmp4m0q35 (Tech Momentum, 3 mints), cmp698wva (Tech Momentum, 16 mints), cmp6bryy (Secular Theme, 10 mints), cmp6dk0w1 (Secular Theme, 0 mints — confirmed dueling).

**No fix:** historical data is what it is. Post-#275 runs are clean. Listed here so future audits don't over-index on pre-#275 discovery transcripts.

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


### P2-17 — `useV2Prompt` flag is dead code on AgentConfig
**Source:** PR #270 deprecated the V1 prompt builder and removed the `useV2Prompt` dispatch from both cron + agent route. The flag column on `AgentConfig` is no longer read anywhere. Currently `true` for all 6 production analysts.

**Fix path:** Prisma migration to drop the column + remove the field from the schema. Trivial migration, just needs a follow-up PR. ~10 minutes.


### ~~P2-18 — Catalyst Event Raider near-no-op morning runs~~
**CLOSED 2026-05-21** by PR #310's `needs-action` 24h look-ahead. Root cause traced to a timing gap: Catalyst's WATCHING theses had `nextReviewAt` set for ~09:30 ET (set by discovery cron on Sundays at 09:00 ET); the daily morning run at 08:00 ET saw them as "not yet due" (strict `< now` check) and skipped. The trigger evaluator's REVIEW_DATE_HIT cron at 09:31 ET then fired a tactical run for each, producing redundant work the morning agent could have done.

**Production proof, 2026-05-21:** Catalyst 0% focus → 42.9% focus, 5 tool calls → 16, 2 trades placed (MRVL + OKTA — first ACTIVE positions ever for this analyst). The 24h look-ahead in `needs-action.ts:218-242` was the single change.

See `GAPS_HISTORY.md` "Done since 2026-05-20" for the full block.


### P2-19 — ThesisSheet skeletons because parent doesn't forward data it already has
**Source:** 2026-05-19 sheet-redesign session. When a user opens `<ThesisSheet>` from `thesis-row.tsx` (watchlist sidebar, stock-page row, trade-row), the parent passes only ~10 props: `ticker, direction, confidenceScore, reasoningSummary, entryPrice, targetPrice, stopLoss, horizon, holdDuration, companyName`. The sheet then fires `/api/theses/[id]/triggers` to fetch the remaining fields (`status, coreBelief, keyAssumptions, invalidationConds, scoring, scoringComposite, sourceKind, sourceRationale, sourceSignalIds, parentThesisId, researchSections, …`) — even though **the parent already has every one of those fields in memory** from the same Prisma query that drew the row.

Net effect: ~300-500ms of skeleton time on every sheet open for data that could have rendered synchronously. The status pill, Core Belief headline, Key Assumptions, Cause for Concern, and Composite Score all sit blank until the round-trip completes.

**Where it bites:**
- `components/ui/thesis-row.tsx:269` — sheet opens from watchlist + stock page + trade row.
- `ThesisRowData` type at `thesis-row.tsx:26` lists only the forwarded fields; the rest aren't even on the type. So upstream queries (e.g. `app/(root)/stocks/[symbol]/page.tsx:286`, `app/(root)/trades/[id]/page.tsx:406`) don't bother selecting them.
- The `/runs/[id]` path (via `components/agent/renderers/ThesisCardRenderer.tsx:92`) DOES spread the full thesis data — that callsite is fine. This gap is specific to the watchlist/stock/trade paths.

**Fix path:**
1. Expand `ThesisRowData` (`components/ui/thesis-row.tsx:26-62`) to include the missing fields.
2. Update the Prisma `select` blocks in `app/(root)/stocks/[symbol]/page.tsx:~270` and `app/(root)/trades/[id]/page.tsx:~390` to include them.
3. In `thesis-row.tsx`, spread the full row into `<ThesisSheet>` instead of cherry-picking 10 props.
4. The `/triggers` fetch in `ThesisSheet` becomes a background refresh (optional — could keep for live updates, or drop entirely if the parent's data is always fresh enough).
5. With this, the skeletons added in the 2026-05-19 split-routes work disappear on every callsite that already has the data. /triggers latency stops mattering for the watchlist/stock paths.

~1-2 hours. Should fire before PR-9 (V2 schema cutover) ships so the new researchSections-flattened columns get forwarded too.

**Update 2026-05-23:** addressed by [PR #313](https://github.com/dave-sucks/hindsight/pull/313) (`fix/p2-19-parent-data-forwarding`) — open, not yet merged. Mark as closed when #313 merges.

### P2-20 — Volume ratio math broken for intraday timestamps (durable fix for the #307 workaround)
**Source:** Follow-up from 2026-05-20 tactical volume gate work (PR #307).

`lib/agent/tools/get-stock-data.ts:166` computes `volumeRatio = today's_accumulated_volume / 20-day_avg_daily_volume`. At 09:45 ET (15 min after open), the accumulated number is mechanically small even when intraday-volume-pace would annualize to >1.5x daily. PR #307 sidestepped this at the prompt layer by gating the volume check on horizon + time-of-day (only TRADE horizon faces the gate, and only after 14:00 ET).

The durable fix is tool-layer: expose a `volumeRatioTimeOfDayAdjusted` field that does `accumulated_volume / expected_at_this_hour_of_20d_avg`. Then the agent can read a number that means "is volume on pace to be exceptional" instead of doing broken raw-ratio math.

**Why P2:** #307's workaround handles the high-impact cases. The math fix matters most for TRADE-horizon tactical fires between 14:00-16:00 ET on modestly-elevated days (the only remaining window where the raw ratio is used). Low frequency, manageable.

**Fix path:** add the field in `get-stock-data.ts:138-179` candle/technicals block. Update intraday-tactical.ts:210 to read the new field instead of the raw one. Remove the time-of-day clause from the prompt once the tool returns a self-correcting number. ~1-2 hours.

### P2-21 — Prisma client stale on `npx tsx` script runs
**Source:** 2026-05-23 repair-script run. PR #308's husky pre-commit hook auto-regenerates the Prisma client when `prisma/schema.prisma` is newer than `lib/generated/prisma/index.d.ts` — but only on `git commit`. Running `npx tsx scripts/foo.ts` against a stale generated client errors with "The column `(not available)` does not exist in the current database" on every prisma write.

Hit twice today: first attempt at the cadence repair script errored on all 33 rows; `npx prisma generate` then retry worked clean.

**Fix path:**
- (Layer 1, hook): add a `prebuild` or `predev` npm script that runs `prisma generate`, OR
- (Layer 1, package.json): add a `pretsx` shim that runs `prisma generate` before any `npx tsx` invocation, OR
- (Layer 2, convention): document at the top of each repair script "run `npx prisma generate` first." Cheapest but the trap repeats.

The first option is cleanest — `npm run dev` already runs migrations check; adding generate would be a one-line addition.

### P2-22 — Cross-analyst discovery duplication
**Source:** 2026-05-17 discovery cron. **Four** analysts independently added AMBA on the same Sunday; same for POET, MDB, ZS, SNOW, OKTA. Audit doc A8; handoff item #6.

The Universe fences don't differentiate analyst strategies enough — multiple analysts whose configs allow Semiconductor-cap-mid-AI-Infrastructure (i.e. most of them) end up picking the same names from the same routed signals. Each analyst minted its own WATCHING thesis for AMBA, with similar entry triggers around $145-$148. Net result: 4 thesis rows for the same name with nearly-identical setups, 4x the trigger evaluator work, 4x the tactical-run noise when AMBA moves.

**Why P2:** affects book quality + tactical noise more than trading correctness. Once #311's discovery cap of 5 is in place (it is), the symptom is bounded — but it's still wasteful. Lower-priority than the action-layer fixes that just shipped.

**Fix path:** add a router-side "already-covered-by-peer-analyst-this-session" check during discovery cron. If analyst-A already minted AMBA today, analyst-B's prompt sees a hint "AMBA already in another analyst's discovery this week — skip unless your edge is meaningfully different." Could also enforce at the record_thesis layer (refuse the Nth mint of the same ticker across all analysts in the same Sunday session). ~1-2 hours.

---

## P2 — Paper cuts and FE polish

### P2-4 — No DAY horizon (decision needed)
SESSION_AUDIT items 33-35. Intraday Momentum Scalper analyst exists but mints theses with `horizon: "TRADE"` (14d max). DAY enforcement happens via EOD-flatten cron, not horizon logic. Decision needed: add a DAY horizon, or document that DAY-style runs use TRADE + EOD-flatten composition. ~1 day if adding the horizon.


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
