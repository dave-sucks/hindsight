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

### P0-6 — Position ↔ Thesis state desync after `place_trade`
**Source:** 2026-05-13 daily run review (see `docs/run-reviews/2026-05-13.md`). Confirmed via direct SQL audit.

**The bug:** `place_trade` does not promote the matching Thesis from WATCHING → ACTIVE. The thesis sits at WATCHING with its ENTER trigger still armed; meanwhile the Position is OPEN and unmanaged. The lifecycle audit memory called this out 2026-05-11 — it's still live.

**Production evidence — 4 broken positions sitting in prod RIGHT NOW** (audit query at end of this section):

| Ticker | Analyst | Thesis Status | Position Status | Opened (ET) | Fill | Days unmanaged |
|---|---|---|---|---|---|---|
| TSM | Tech Momentum Trader | WATCHING (target $410, stop $359) | OPEN 6.01sh | 2026-05-07 | $415.77 | 6 |
| AVGO | Earnings Drift Trader | WATCHING (target $470, stop $395) | OPEN 7.22sh | 2026-05-08 | $415.36 | 5 |
| GOOGL | Secular Theme Architect | WATCHING (target $370, stop $320) | OPEN 6.30sh | 2026-05-08 | $397.09 | 5 |
| AMD | Tech Momentum Trader | WATCHING (target $460, stop $380) | OPEN 5.60sh | 2026-05-12 | $446.29 | 1 |

**Downstream consequences:**
- Trigger evaluator keeps re-firing the ENTER trigger every day (predicate matches, status is WATCHING, no EXIT trigger to fire instead) → promotion-gate failures pile up.
- Position has no EXIT triggers at the actual fill price — only the WATCHING-stage `PRICE_BELOW $stop` which targets the planned stop, not the real-fill stop.
- `get_theses` returns these rows with their `reasoningSummary` text claiming "Entry executed" (true), but `status` field says WATCHING (false). Agent reads contradictory truth, treats as "held in portfolio, no action needed", skips the daily review → another gate failure.
- 4 positions × ~$2K each = ~$8K of paper exposure with broken management.

**Fix path:**
1. **Code:** [lib/agent/tools/place-trade.ts](../lib/agent/tools/place-trade.ts) — when the matching Thesis is WATCHING, refuse the call with a clear rejection message: *"Thesis $X is WATCHING. Promote it first by calling update_thesis(thesis_id, change_status='ACTIVE', target_price, stop_loss) — using values relative to the live entry, not the planned WATCHING entry. Then retry place_trade."* The agent can't forget what the tool requires.
2. **Data:** manually promote the 4 affected theses. Each needs `entry_price` = position.avgCost, plus an analyst-chosen `target_price` + `stop_loss` (the WATCHING-stage values were entry-triggers, not exits). See "Action items" below.
3. **Audit:** the SQL below is the durable detector. Add a hygiene cron that runs daily and alerts on any new entries (or auto-promotes with defaults). Out of scope for this PR.

**Detector SQL** (zero rows = clean):

```sql
SELECT t.id, t.ticker, t.direction, t.status::text,
       p.id AS position_id, p."avgCost", ac.name AS analyst
FROM "Thesis" t
JOIN "ResearchRun" r ON r.id = t."researchRunId"
JOIN "AgentConfig" ac ON ac.id = r."agentConfigId"
JOIN "Position" p
  ON p."analystId" = r."agentConfigId"
  AND p.symbol = t.ticker
  AND p.direction = t.direction
  AND p.status = 'OPEN'
WHERE t.status::text = 'WATCHING';
```

---

### P0-7 — Promotion gate is post-run + uses different rules than `needsAction`
**Source:** 2026-05-13 daily run review. Two distinct issues, one root cause.

**Issue A — gate has no teeth.** Promotion gate lives in `record_run_summary` ([record-run-summary.ts](../lib/agent/tools/record-run-summary.ts)). It marks `ResearchRun.status: RUNNING → FAILED` atomically when a triggered WATCHING thesis is unaddressed. Then returns a success-shaped result to the agent. The agent's next call is `complete_run` ([complete-run.ts](../lib/agent/tools/complete-run.ts)), which sees `RUNNING → COMPLETE` is a no-op (already FAILED) but returns success-shaped. Agent thinks run completed cleanly. 2026-05-13 Secular Theme transcript captured the agent reading the gate's complaint and literally narrating *"I'll ensure that the GOOGL thesis is prioritized in the next session"* before calling `complete_run` and walking away.

**Issue B — gate ignores cooldown.** [needs-action.ts:178](../lib/agent/needs-action.ts:178) calls `shouldFire(trigger, ...)` which respects `cooldownDays`. The promotion gate does its own live-price-vs-target check with no cooldown awareness. Result: `get_theses.needsAction` correctly tells the agent "nothing to do on GOOGL (cooldown active)"; the gate then punishes the agent for not doing anything on GOOGL. The agent followed the data feed the prompt told it to use and got blamed for it.

**Fix path (one move solves both):**
1. **Move the gate from `record_run_summary` to `complete_run`'s preflight.** Refuse `RUNNING → COMPLETE` if any triggered WATCHING thesis (per `shouldFire` — cooldown-aware) is unaddressed in this run. Return `ok: false` with the same gate message. Agent sees rejection in-conversation, can recover.
2. **Use `shouldFire` instead of raw price-vs-target.** Same rules everywhere — Layer 2 (`needsAction`) and Layer 1 (`complete_run` preflight) ask the same question.
3. Delete the gate from `record_run_summary`'s persistence path. Layer 1 is the right home.

---

### P0-8 — Narration-gate false positives
**Source:** 2026-05-13 daily run review. EV Catalyst Event Trader failed because `\badjusted\b` matched "adjusted target" in the TSLA decision rationale, even though "adjust target" is correctly handled by `update_thesis` (not `manage_position`).

**Fix path:** [lib/agent/narration-gate.ts:95-99](../lib/agent/narration-gate.ts:95) — tighten the regex to require a position-management noun (stop, trail, size, qty, position) following or near "adjusted":

```ts
// Today:
{ pattern: /\badjusted\b/gi, expectedTool: "manage_position", label: "adjust" }
// Fix:
{ pattern: /\badjusted\b[^.]{0,30}\b(stop|trail|size|qty|position)\b/gi, ... }
```

Don't fire on "adjusted target / thesis / plan / outlook" — those are `update_thesis` territory per [THESIS_ARCHITECTURE.md §6](./THESIS_ARCHITECTURE.md) (target/stop are operational state mutated via `update_thesis`).

---

### P0-9 — `place_trade` and `complete_run` contract hygiene
**Source:** 2026-05-13 daily run review. Three small but distinct holes.

**P0-9a — `analyst_id` is exposed in `place_trade`'s agent-visible schema.** It should come from `ctx.analystId` only. Today the agent can supply a wrong value and get rejected for it — exactly what happened to Intraday Momentum's second INTC attempt 2026-05-13 ("trade placement failed due to an issue with the analyst identifier"). Fix: remove from Zod schema in [place-trade.ts](../lib/agent/tools/place-trade.ts), inject from ctx.

**P0-9b — `morning-research` error aggregator misses place_trade rejections.** [lib/inngest/functions/morning-research.ts:218-235](../lib/inngest/functions/morning-research.ts:218) reads `r?.output?.ok === false` to count errors. Place_trade rejections returned envelopes that the aggregator counted as `errors: 0`. Result: `toolStats.byTool.place_trade.errors = 0` even when both calls failed. Every silent fail invisible in telemetry. Fix: confirm place_trade's rejection envelope shape and align the aggregator OR have place_trade return `ok: false` consistently.

**P0-9c — `complete_run` accepts when `record_run_summary` wasn't called in this run.** 2026-05-13 Intraday Momentum: two place_trade rejections, then straight to `complete_run` — V2 prompt requires `record_run_summary` before `complete_run`, agent skipped it, tool accepted. Fix: [complete-run.ts](../lib/agent/tools/complete-run.ts) preflight refuses unless a `run_summary` RunEvent exists for this run.

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
