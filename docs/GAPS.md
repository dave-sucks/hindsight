# Hindsight — Gaps

> **What this is:** the ordered punch list of every known gap between [`/agent-workflow`](../app/(root)/agent-workflow/page.tsx) (current state) and [`VISION.md`](./VISION.md) (target state). Each item has a severity, a concrete fix path, and the audit it came from.
>
> **How to use it:** start at the top. P0s block the product. P1s degrade quality but the system still functions. P2s are paper cuts. Don't skip levels.
>
> **Last refreshed:** 2026-05-07 — synthesized from a 5-agent audit of the codebase + Supabase production-data queries. Successor to `ARCHITECTURE_DEEP_AUDIT.md` and `SESSION_AUDIT_2026_05_06.md` (both now archived).

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

### Watching trigger health (2026-05-07)

| Analyst | Watching | with ENTER | with EXIT | zero triggers | avg/thesis |
|---|---|---|---|---|---|
| Catalyst Event Raider | 5 | 4 | 0 | 0 | 4.6 |
| Earnings Drift Trader | 6 | 4 | 0 | 0 | 4.2 |
| EV Catalyst Event Trader | 6 | **1** | 0 | 0 | 4.2 |
| Global Event-Driven ETF | 14 | 12 | 0 | 0 | 4.9 |
| Intraday Momentum Scalper | 2 | 2 | 0 | 0 | 5.0 |
| Secular Theme Architect | 5 | 4 | 0 | 0 | 4.6 |
| Tech Momentum Trader | 5 | 2 | 0 | 0 | 4.2 |

**Reading:** PR #217 worked — zero EXIT triggers on watching theses, zero zero-trigger watching theses. But **11 of 43 watching theses (26%) still have no ENTER trigger** — they have other triggers (REVIEW, news-based) but no entry-promotion path. EV Catalyst Trader (1/6) and Tech Momentum Trader (2/5) are the worst.

### Goalpost-moving check (2026-05-07)

The MRVL anti-pattern (raising target on a watching thesis when current price is already at/above the old target, instead of trading): **0 occurrences on 5/07.** Either the agent stopped doing it, or it actually traded the names that would have triggered it (which fits the 10 INITIATE count). Caveat: one day of data, can't conclude trend yet.

### Monitor health (all-time)

| Type | Count | Active 7d | Stale or dead | Trades sourced | Wins |
|---|---|---|---|---|---|
| API | 4 | 4 | 0 | 0 | 0 |
| DOMAIN | 42 | 37 | 5 | 0 | 0 |
| EMAIL | 26 | 21 | 1 | 0 | 0 |
| SEARCH | 76 | 32 | **44** | 2 | 1 |
| **Total** | **148** | **94** | **50** | **2** | **1** |

**Reading:** **Two of the worst findings in the audit.** (1) Of 76 SEARCH monitors, only 32 fired in the last 7 days; 44 are stale or never run. The signal pipeline is bloated with dead queries. (2) Across 148 monitors and ~weeks of trading, only 2 trades have ever been credited back to a source monitor. **The Monitor ROI tracer is not functioning** — either `Thesis.sourceSignalIds → Signal.monitorId → Monitor` is broken, or theses aren't citing signals when minted, or the trade evaluator isn't running. The "self-improving via monitor scores" loop in [`VISION.md`](./VISION.md) Pillar 5 does not currently exist.

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

### P0-2 — Promotion check missing from daily-run prompt
**Source:** ARCHITECTURE_DEEP_AUDIT (Step 2) + prompts agent audit (the prompt has soft language but no enforcement gate).

**Why it matters:** the MRVL anti-pattern (raise target on a watching thesis when entry condition is already met, walk away). This is the single biggest behavioral regression from the old "mint a fresh thesis daily" era. The daily prompt today says "HOLD-only is fine when no entry condition is met" but does not enforce a check.

**Fix path:**
1. Add a hard PROMOTION CHECK section to `lib/agent/system-prompt.ts` MORNING_PLAN before Stage 6 complete_run. For every WATCHING thesis: get current price, check entry condition, MUST evaluate INITIATE or document specific rejection reason (volume, regime, news).
2. Add a runtime gate in `record_run_summary` that refuses `primary_decision: HOLD` when any WATCHING thesis has currentPrice ≥ targetPrice (LONG) AND no `place_trade` landed for that ticker, OR any update_thesis raised a target on a watching thesis whose current price was already at/above the old target.
3. Re-run the goalpost-moving query daily for a week to confirm the fix holds.

**Effort:** ~3 hours (prompt edit + tool gate + verification).

### P0-3 — Generalized narrate-vs-execute gate
**Source:** ARCHITECTURE_DEEP_AUDIT (Step 3) + prompts agent audit (PR #210 fixed `place_trade` only; the same pattern moved to `manage_position`, `manage_watchlist`, `close_position`).

**Why it matters:** the agent narrates "I'll close this" or "I'll add NVDA to the watchlist" without calling the tool. Each per-tool gate plays whack-a-mole — the bug just migrates.

**Fix path:**
1. Add a generalized validator (a new tool `validate_run_intent` or part of `record_run_summary`) that:
   - Parses every TradeDecision's `reasoning` text for action verbs (close, sell, trim, scale, tighten stop, watchlist add/remove, buy)
   - Verifies a corresponding tool call landed during the run
   - Flags mismatches as `RunEvent` warnings
2. Optional v2: refuse `complete_run` when narrate-without-execute mismatches exceed a threshold.

**Effort:** ~4 hours (verb parser + cross-reference + RunEvent emission).

### P0-4 — Monitor ROI tracer is not functioning
**Source:** Supabase — 2 trades ever credited across 148 monitors.

**Why it matters:** the entire "self-improving" loop in VISION Pillar 5 depends on this. Without it, there's no way to know which monitors are paying for themselves and which are noise.

**Fix path:**
1. Verify `Thesis.sourceSignalIds` is being populated on `record_thesis` calls. (Today's 10 INITIATEs are a good sample — query: `SELECT id, sourceSignalIds FROM "Thesis" WHERE createdAt::date = '2026-05-07'`.)
2. Verify `Signal.monitorId` is being populated when signals are created.
3. Verify `lib/inngest/functions/trade-evaluator.ts` actually runs on `trade/closed` and updates Monitor counters.
4. Walk the chain end-to-end for one closed trade today (e.g. GOOGL or MU) — find the signal it cited, find the monitor that produced the signal, confirm the monitor's counters incremented.

**Effort:** ~2-4 hours (chain-walking + likely 1-3 fixes along the way).

### P0-5 — Horizon awareness is mostly cosmetic
**Source:** Hold-style audit (overall grade D+).

**Why it matters:** this is the most important pillar from VISION.md and the one most at risk. The system says it's horizon-aware (triggers differ per horizon, A-) but doesn't behave horizon-aware (daily prompt grade C, action layer D, data fetching F).

**Fix path (sub-items, in order):**
1. **P0-5a** — Make horizon visible in the daily-run prompt portfolio + Live Theses tables (currently absent; agent must click into the thesis card to remember exit policy).
2. **P0-5b** — Move time-based exit enforcement from prompt to code. `lib/trade-exit.ts` and `lib/inngest/functions/price-monitor.ts` should accept and respect `Thesis.horizon`. Code rule: `if (horizon === "TRADE" && daysHeld >= maxHoldDays) → trigger REVIEW`.
3. **P0-5c** — Branch daily prompt on horizon. Separate alert thresholds: "5% of stop" for TRADE, "10% of stop" for COMPOUNDER. Separate guidance: "COMPOUNDER theses ignore intraday moves <-3% absent fundamental invalidation."
4. **P0-5d** — Add horizon promotion path. `update_thesis.horizon` is in the schema but the description discourages it ("Rarely changed"). Rewrite the description to invite promotion, document the workflow ("TRADE that's compounding → upgrade to TARGET; update maxHoldDays + nextReviewAt to match").
5. **P0-5e** — Differentiate data fetching per horizon. Long-term theses should pull SEC filings + analyst consensus more; intraday should pull options flow + volume.

**Effort:** ~1-2 days for P0-5a through P0-5d. P0-5e is bigger.

---

## P1 — Quality is degraded but system functions

### P1-1 — 11 watching theses missing ENTER triggers
**Source:** Supabase — 11 of 43 watching theses (26%). EV Catalyst Trader (1/6), Tech Momentum Trader (2/5).

**Why it matters:** these theses have no entry-promotion path. The trigger evaluator can't fire on them. They sit on the watchlist as decoration.

**Fix path:**
- One SQL: identify them, close them, force agent to re-mint with proper triggers, OR backfill default ENTER triggers via the `defaultTriggersForHorizon('LONG' | 'SHORT', 'WATCHING')` factory.
- Long-term: add a runtime guard in `record_thesis` and `manage_watchlist` that refuses to mint a WATCHING thesis with a numeric target unless ENTER triggers are attached.

**Effort:** ~1 hour (SQL + add guard).

### P1-2 — Monitor pipeline bloat (44 dead SEARCH monitors)
**Source:** Supabase — 44 of 76 SEARCH monitors stale or never-run.

**Why it matters:** dead monitors cost inference budget on wakeup, dilute signal quality, and clutter the /intelligence health view.

**Fix path:**
1. Audit the 44 stale SEARCH monitors — when were they created, what's the last fire date, why didn't they fire?
2. Likely root cause: orphaned monitors from analysts that were edited or deleted. Add a cleanup cron (or extend `lib/inngest/functions/pipeline-cleanup.ts`) to soft-delete monitors with `lastRunAt > 30 days ago` AND `tradesSourced = 0`.

**Effort:** ~1-2 hours.

### P1-3 — Trigger evaluator is hourly, not "every 15 min"
**Source:** Crons agent audit — Inngest cron is `0 9,10,11,12,13,14,15,16 * * 1-5` (hourly), not every-15-min.

**Why it matters:** registry and CLAUDE.md both claim 15-min cadence. Reality is hourly. For DAY-style trades or fast-moving names, an hourly evaluator misses the window. Item 34 in SESSION_AUDIT (now legacy) flagged that `PRICE_MOVE_PCT` / `VS_SMA` triggers don't fire on the cron path at all.

**Fix path:** decide which is correct — bump cron frequency to actually run every 15 min (Inngest doesn't support `*/15` natively in cron; would need scheduled function pattern), OR update registry/CLAUDE.md to say "hourly + on signal.routed". The registry's already been updated as of 2026-05-07.

**Effort:** if we want true 15-min, ~2 hours. If we accept hourly, the doc fix already shipped — 0 hours.

### P1-4 — Discovery softer than required at minting
**Source:** Prompts audit — the discovery-to-action wiring softer than ARCHITECTURE_DEEP_AUDIT Step 6 requires.

**Why it matters:** the prompt says "Research ≥ 2 new tickers every run; worthy names go to watchlist via manage_watchlist." Audit demanded "convert at least N high-conviction signals to fresh `record_thesis` calls when discovery slots are open." Watchlist items don't trigger the per-thesis review loop the same way.

**Fix path:** sharpen the prompt language in the daily-run + discovery prompts. "Watchlist add" is the fallback; `record_thesis` (WATCHING status) is the default for high-conviction discoveries.

**Effort:** ~30 min.

### P1-5 — Editor's lane taxonomy lives in registry only, not prompt
**Source:** Prompts audit.

**Why it matters:** the registry describes a 4-lane classification (Q&A, numeric, fence, archetype) that determines which prompt instructions apply. The editor prompt itself doesn't mention these lanes. If the editor session is spawned in isolation it has no idea what lanes are.

**Fix path:** add the lane taxonomy to `lib/agent/builder-prompt-template.ts` (editor variant) so the agent reads it.

**Effort:** ~30 min.

### P1-6 — `get_sec_filings` claimed for builder but missing from allowlist
**Source:** Tools agent audit — registry's `builder` team has `get_sec_filings` in `tools[]`, but `lib/agent/modes.ts` BUILDER allowlist omits it.

**Why it matters:** the page advertises a tool the builder can't actually use.

**Fix path:** decide intent. If builder should have it (likely yes — Q&A about value plays needs filings access), add to BUILDER allowlist in modes.ts. If not, remove from registry team.tools.

**Effort:** ~5 min.

### P1-7 — Overdue reviews not picked up by housekeeping cron
**Source:** SESSION_AUDIT item 11 — MRVL had `nextReviewAt: 5d ago`, never re-reviewed.

**Why it matters:** theses that need attention sit silent until something else fires.

**Fix path:** find the housekeeping cron in `lib/inngest/functions/`, add `nextReviewAt < NOW()` to its query regardless of trigger state. Emit an event that wakes a tactical run on overdue.

**Effort:** ~1 hour.

### P1-8 — Triggers fire 0× during agent runs (only via cron)
**Source:** SESSION_AUDIT item 12.

**Why it matters:** the agent isn't checking trigger state during the morning walk. It's reading `get_theses` and editing rationales in isolation. Every trigger fire we've seen came from the 15-min cron path.

**Fix path:** add a step in the daily-run prompt that explicitly asks "are any of my thesis triggers currently true given today's prices?" before the per-thesis review loop. Or pre-compute and inject as context.

**Effort:** ~1 hour.

---

## P2 — Paper cuts and FE polish

### P2-1 — 6 PASS-on-watchlist theses with no triggers
SQL fix from SESSION_AUDIT item 8. ~5 min.

### P2-2 — `manage_watchlist` defaults to TRADE horizon
Hold-style audit — biases new watchlist entries toward short-term. Should default to TARGET when there's no explicit catalyst. ~15 min.

### P2-3 — Watching templates don't vary by horizon
Hold-style audit — `watchingDefaults()` in `lib/agent/triggers/defaults.ts` ignores horizon. A WATCHING/CATALYST should have a date-based entry trigger; WATCHING/TRADE should have a tighter stop. ~2 hours.

### P2-4 — No DAY horizon
SESSION_AUDIT items 33-35. Intraday Momentum Scalper analyst exists but mints theses with `horizon: "TRADE"` (14d max). DAY enforcement happens via EOD-flatten cron, not horizon logic. Decision needed: add a DAY horizon, or document that DAY-style runs use TRADE + EOD-flatten composition. ~1 day if adding the horizon.

### P2-5 — `sync-heartbeat.ts` is dead
Crons agent — file exists, imports exist, but not in `app/api/inngest/route.ts` `functions[]` array. Either wire it up or delete the file. ~5 min.

### P2-6 — Thesis sheet UI items
SESSION_AUDIT items 20-32 (FE work). Status pill should be a sentence ("Watching for entry > $268 · 1.9% below"); horizon needs an exit-policy explanation; trigger panel needs proximity-to-fire chips; activity log should call out "edited in this run"; Plan section needs to exist; horizon override control; days-held / maxHoldDays progress; overdue review red flag; run-detail "Why these tickers?" panel. Half-day to a full day each.

### P2-7 — Intelligence pipeline crons are independent
Crons agent — no Inngest `.after()` or `.waitFor()` between firm-market-sweep → portfolio-watchlist-monitor → domain-monitor → signal-router. If one lags, downstream still fires on schedule with stale data. Today this is theoretical; flag it as a known fragility. ~2 hours to add chaining.

### P2-8 — Briefing isn't a separate cron
Crons agent — registry implies it is. Already clarified in 2026-05-07 registry edit ("Inline after every run, no separate cron"). No code change needed; documentation only.

### P2-9 — CLAUDE.md tool count says 19, registry has 25
Tools agent — CLAUDE.md predates `update_thesis`, `get_portfolio_context`, `get_earnings_calendar`, `get_market_movers`, etc. Update the count and the itemized list. ~10 min.

### P2-10 — Podcast tools missing from TOOL_REGISTRY
Tools agent — `read_past_transcripts`, `suggest_podcast_config`, `write_segment_transcript` exist in `lib/agent/tools/` but not in `TOOL_REGISTRY`. Decision: either add them with their own podcast-feature teams in the registry, or document explicitly that podcast is out-of-scope for `/agent-workflow` (the registry header comment now says this). Status quo is fine; revisit if podcast becomes a first-class feature.

---

## Done since 2026-05-06 audit

For posterity — what got fixed in the last 24h:

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

## How to keep this doc honest

1. When a fix lands, move the item to "Done since" with the PR number.
2. When a new gap is found, add it to the right priority section (don't dump everything in P2).
3. When the production-data snapshot is more than 7 days old, re-run the queries.
4. When the workflow page diverges from this doc, **the workflow page is right** — update GAPS.md to match. The page is the source of current state; this doc is a delta against the vision.
