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

5. ~~**P0-5e** — Per-horizon data-fetching guidance in the prompt.~~ ✅ Closed 2026-05-13 — V2 daily-run prompt now has a "Per-horizon data discipline" section: TRADE pulls options flow + technicals, CATALYST pulls earnings/filings keyed to the event, TARGET is balanced, COMPOUNDER pulls filings + earnings + market context and explicitly does NOT pull options flow. See `lib/agent/system-prompt.ts` § Per-horizon data discipline.

**Total remaining:** P0-5 is fully closed. P0-5a/d (admin sweep + PR #239), P0-5b/c (Morning Run V2), P0-5e (this PR). Horizon awareness now lives in three places — the daily prompt (visibility + per-horizon review cadence + per-horizon data discipline), per-thesis triggers (authoritative for exits), and the trigger evaluator (5-min cron evaluating those triggers).

---

## P1 — Quality is degraded but system functions

*(P1-4 was closed via cumulative prompt sharpening across PRs #235 + #239 — see "Done since" below. P0-5e was downgraded here from P0; see P0-5 above for details.)*

### P1-9 — Discovery prompt is archetype-blind (biggest remaining item)
**Source:** Discovery review 2026-05-11 (see `DISCOVERY_REVIEW.md`). The 4-dimension scoring rubric (trendStrength / relativeStrength / entryQuality / catalystFreshness) is calibrated for momentum/breakout playbooks and applied universally. A Deep Value Contrarian buys downtrends — `trendStrength: 3` is a SELL signal for them. An Insider Cluster Buying archetype has no slot in the rubric for Form 4 cluster patterns. Catalyst Event Trader / Earnings Drift should weight earnings_calendar heavily; momentum scoring barely.

**Fix path:** branch the discovery prompt into three families — EVENT_DRIVEN (Earnings Drift, Catalyst Event), MOMENTUM (Momentum Breakout, Mean Reversion, Sector Rotation, Unusual Options), FUNDAMENTAL (Deep Value, Thematic Secular, Insider Cluster) — each with a tuned scoring rubric and primary source priority. Requires either an `AgentConfig.archetypeId` column or runtime classification from analystPrompt + holdDurations. Full spec in `DISCOVERY_REVIEW.md` § Proposed redesign. ~1 session of work.

---

## P2 — Paper cuts and FE polish

### P2-4 — No DAY horizon (decision needed)
SESSION_AUDIT items 33-35. Intraday Momentum Scalper analyst exists but mints theses with `horizon: "TRADE"` (14d max). DAY enforcement happens via EOD-flatten cron, not horizon logic. Decision needed: add a DAY horizon, or document that DAY-style runs use TRADE + EOD-flatten composition. ~1 day if adding the horizon.


### P2-7 — Intelligence pipeline crons are independent
Crons run on independent schedules — no Inngest `.after()` or `.waitFor()` between firm-market-sweep → portfolio-watchlist-monitor → domain-monitor → signal-router. If one lags, downstream still fires on schedule with stale data. Today this is theoretical; flag it as a known fragility. ~2 hours to add chaining. Largely mitigated by P1-10's event-emission (signals get routed immediately when each producer finishes), but the cron-schedule ordering isn't itself enforced.


### P2-12 — Discovery prompt doesn't mention `manage_watchlist` (blocked)
**Blocked on:** [`docs/WATCHLIST_COLLAPSE_PLAN.md`](./WATCHLIST_COLLAPSE_PLAN.md).
`manage_watchlist` is in `MODES.discovery.toolAllowlist` but the prompt never names it. After the watchlist collapse, this gap resolves itself: `record_thesis(status: WATCHING)` IS the watchlist add. The tool either becomes a wrapper or is removed entirely. Do not fix in isolation.

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
