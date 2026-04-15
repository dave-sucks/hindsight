# Agent Audit — Implementation Plan
_Source: Deep analysis of Tech Momentum Raider, 15 runs through April 14, 2026_

---

## Status Key
- `[ ]` not started
- `[~]` in progress / partially done
- `[x]` complete

---

## Priority 0 — Blockers (Discovery Dead, Signal Noise)

### P0-A: Signal Router — Discovery Bucket
**Problem:** Router only routes signals for tickers already in the analyst's watchlist/positions. New tickers never surface unless they're already known. AVGO/GOOGL BREAKING signals never reached the analyst.

**Fix:**
- Tag routes where NO ticker matches analyst's known universe with `routeReason: "discovery:sector_match:X"` prefix
- Cap discovery routes at 5 per analyst per run so they don't crowd known-ticker intel
- Filter out signals with `freshness === "OLDER"` before routing (stale stories shouldn't re-enter)
- Filter out signals with `noveltyScore < 25` (overplayed stories — same headline seen 30+ times)

**Files:**
- `lib/inngest/functions/signal-router.ts` — `computeRelevance()` + routing loop + signal select

**Status:** `[~]` — done in session 1, needs review

---

### P0-B: noveltyScore Actually Computed
**Problem:** Every single signal in the DB has `noveltyScore: 50` (the hardcoded default). The router can't distinguish fresh intel from repeated noise. NVDA had 56 signals on one day — all scored identically.

**Fix:**
- Add `computeNoveltyScore(tickers: string[]): Promise<number>` in `lib/intelligence/signals.ts`
- Score based on how many signals for those tickers exist in the past 7 days:
  - 0 recent → 80 (fresh)
  - 1–4 → 65
  - 5–14 → 45
  - 15–29 → 30
  - 30+ → 20 (noise)
- Call it in `createSignal()` when `noveltyScore` is not provided

**Files:**
- `lib/intelligence/signals.ts` — new `computeNoveltyScore()` + `createSignal()` auto-compute

**Status:** `[~]` — done in session 1, needs review

---

## Priority 1 — High Impact (Agent Behavior)

### P1-A: read_signals — Expose Discovery Flag
**Problem:** Even after discovery tagging in the router, the agent doesn't know which signals are "new" vs "known ticker." It treats everything the same and converges on the same 3 names.

**Fix:**
- Add `isDiscovery?: boolean` to `SignalItem` type
- Set it to `true` when `routeReason` does not contain `"ticker_match:"` 
- Update summary string: `"X signals (Y discovery, Z urgent, ...)"` so the agent sees it immediately

**Files:**
- `lib/agent/tool-types.ts` — `SignalItem` interface
- `lib/agent/tools/read-signals.ts` — set `isDiscovery`, update summary

**Status:** `[~]` — done in session 1, needs review

---

### P1-B: System Prompt — Mandatory Holdings Research + Discovery Enforcement
**Problem:** Agent runs in 47–90 seconds. It's not calling `get_stock_data` on every position. Phase 2 is optional ("MUST if flagged, SHOULD if..."). Discovery is never enforced. Concentration risk is never checked.

**Fix (in `lib/agent/system-prompt.ts`):**
1. **Portfolio section:** For each position, show `daysHeld` vs configured `holdDuration` — flag overdue positions with `⚠ EXCEEDS configured hold duration. Decide: extend with rationale or close.`
2. **Stage 2 — Holdings:** Change from "MUST if flagged, SHOULD otherwise" → `get_stock_data on ALL open positions, no exceptions. This is your daily risk review.`
3. **Stage 2 — Concentration risk:** After researching holdings, explicitly check: "Are all positions correlated? Same sector? Same macro driver? Flag it."
4. **Stage 2 — Discovery:** "Research at least 1–2 discovery signals per session (isDiscovery=true in read_signals output) when signals contain them."
5. **Stage 3 — Theses:** For positions exceeding hold duration: "Record a fresh thesis that explicitly justifies extension or closes the position."
6. **Hard Rules:** Add: `get_stock_data on ALL open positions is mandatory — no exceptions.`

**Files:**
- `lib/agent/system-prompt.ts` — portfolio section + run flow stages 1–3 + hard rules

**Status:** `[~]` — done in session 1, needs review

---

### P1-C: Add adjust_position / scale_position Tools
**Problem:** Agent is at 3/3 capacity. It correctly noted NVDA is up 1.8% with confirmed thesis but literally cannot act — there's no tool to add shares to an existing position or trail the stop on winners.

**Fix:**
- The existing `manage_position` tool might already handle `update_targets` and `set_trailing_stop` — verify what it actually does
- If trailing stop and target adjustment aren't wired: add them to `manage_position`'s action enum
- `scale_position` (add shares to existing): new tool or extend `manage_position` with `add_shares` action
  - Enforce: can't exceed `maxPositionSize`
  - Enforce: only when `manage_position` returned success

**Files:**
- `lib/agent/tools/manage-position.ts` — review existing actions, extend if needed
- `lib/agent/tools/index.ts` — export new tool if added
- `lib/agent/tools.ts` — register in `createResearchTools()`
- `lib/agent/system-prompt.ts` — document in Stage 4

**Status:** `[ ]`

---

## Priority 2 — Quality of Life

### P2-A: Hold Duration Enforcement in price-monitor Cron
**Problem:** Analyst configured `holdDurations: ['DAY']` but average hold is 88 hours. The price monitor cron runs hourly but never closes DAY positions at market close.

**Fix:**
- In `lib/inngest/functions/price-monitor.ts`: at market close (4 PM ET), check all positions where analyst's holdDurations includes "DAY" and the position has been open > 1 trading day
- Auto-call `close_position` logic or create a `PositionManagementAction` with `actionType: "HOLD_EXCEEDED"` to flag it for the agent

**Files:**
- `lib/inngest/functions/price-monitor.ts`

**Status:** `[ ]`

---

### P2-B: Post-Run Briefing — Prescriptive, Not Descriptive
**Problem:** `selfCorrections` in the briefing are generic platitudes ("implement automated alerts"). The briefing describes what happened, not what went wrong and why. Closed losses are not named. Discovery gap is not tracked.

**Fix (in `lib/agent/update-analyst-briefing.ts`):**
1. **Loss analysis:** For each closed LOSS, force GPT-4o to name the trade explicitly: "We shorted $AKAM on [date] expecting [X]. Insider buying signals conflicted. Lesson: [specific rule]."
2. **Concentration risk:** If all open positions share a signal type / sector, flag it explicitly in `strategyNotes`.
3. **Discovery gap:** Track whether any new ticker was traded this session. If not: "This is run #N. No new tickers discovered. Watchlist needs fresh names."
4. **"What would change my thesis":** For each open position, the brief should note: "What single data point would make you close this?"

**Files:**
- `lib/agent/update-analyst-briefing.ts` — briefing prompt, portfolio stats computed before prompt

**Status:** `[~]` — partial in session 1, needs review and completion

---

### P2-C: Morning Brief — Surface Discovery Opportunities
**Problem:** The morning brief's `newOpportunities` section is supposed to surface new tickers but it only uses tickers from routed signals. Routed signals previously only covered known tickers. Now that discovery routing works (P0-A), this should flow through.

**Fix:**
- In `morning-brief-generator.ts`: ensure signals tagged `discovery:` in `routeReason` are the **first candidates** for `newOpportunities`
- Add explicit instruction: "newOpportunities MUST include at least 1 ticker from discovery-routed signals (routeReason starts with 'discovery:') if any exist. These are tickers NOT in current positions or watchlist."

**Files:**
- `lib/inngest/functions/morning-brief-generator.ts` — `buildBriefContext()` + GPT-4o prompt

**Status:** `[ ]`

---

## Priority 3 — Signal Quality

### P3-A: Stale Signal Routing Age Filter
**Problem:** Signals older than 48 hours (but created "today" by the pipeline) shouldn't be re-routed unless they're evergreen. MU had a signal from October 2025 surfacing in April 2026.

**Fix:**
- In `signal-router.ts`: add `freshness: { not: "OLDER" }` filter to unrouted signals query (signals with `freshness=OLDER` should not route)
- Optionally: add `expiresAt` filter — signals with explicit `expiresAt` in the past are skipped

**Files:**
- `lib/inngest/functions/signal-router.ts` — Step 2 signal query

**Status:** `[~]` — `freshness: OLDER` filter added in session 1. The `expiresAt` guard is not yet added.

---

### P3-B: Purpose-Built Monitors for This Analyst
**Problem:** Signal content is all news-repetition on known names. No breakout alerts, no options flow anomalies, no earnings catalysts from systematic scans.

**Fix:** Create Monitor records scoped to the analyst for:
1. `BREAKOUT` — tech stocks crossing 52-week high or volume 3x average (FMP screener or Sonar query)
2. `MOMENTUM` — top 10 tech momentum gainers past 5 days
3. `OPTIONS_FLOW` — unusual options activity in tech (FMP)
4. `EARNINGS_CATALYST` — tech earnings next 5 trading days (Finnhub)

These are created via the `/intelligence` UI or seeded in a migration/script.

**Files:**
- Manual: add via `/intelligence` page Monitor creation UI
- Or: `prisma/seed.ts` / a one-time script

**Status:** `[ ]`

---

## Session Log

| Session | Date | Work Done |
|---------|------|-----------|
| Session 1 | 2026-04-15 | P0-A, P0-B, P1-A, P1-B (partial), P2-B (partial), P3-A (partial) — all need review before commit |

---

## Open Questions

1. Does `manage_position` already support trailing stop and target updates? → Check `lib/agent/tools/manage-position.ts` before building P1-C
2. Is `AnalystSignalRoute.routeReason` long enough to hold the `"discovery:sector_match:X, theme_match:Y"` format? (It's a plain `String` — should be fine)
3. Does the price monitor have access to analyst `holdDurations`? Need to check `price-monitor.ts` before P2-A
4. The `noveltyScore` computation in `createSignal` adds N async DB queries for batch creates. At 50 signals/batch this is 50 queries. Acceptable for a 6:30 AM background job but worth batching if it causes timeouts.
