# Agent Audit — Full Implementation Plan
_Source: Deep audit of Tech Momentum Raider, 15 runs through April 14, 2026_
_Parts I + II of the analysis session_

---

## Status Key
- `[ ]` not started
- `[~]` in progress / partial (session 1 work — needs review)
- `[x]` complete

---

## ⚠ Session 1 Work Already Committed
The following changes were made in session 1 (branch `claude/fix-report-crashes-Ph7Hz`).
**These need review against the full Part II analysis before relying on them.**

| File | What changed | Part II verdict |
|------|-------------|-----------------|
| `lib/intelligence/signals.ts` | Auto-compute noveltyScore at creation time | **Superseded** — Part II says compute at routing time, not creation time |
| `lib/inngest/functions/signal-router.ts` | Filter OLDER/low-novelty signals, tag discovery routes | **Directionally right** but noveltyScore logic needs to move here |
| `lib/agent/tool-types.ts` | `isDiscovery` flag on SignalItem | **Keep** |
| `lib/agent/tools/read-signals.ts` | Discovery count in summary | **Keep** |
| `lib/agent/system-prompt.ts` | Mandatory holdings research, hold-duration warnings, concentration risk | **Keep, extend** with Part II additions |
| `lib/agent/update-analyst-briefing.ts` | Prescriptive brief prompt, loss analysis, discovery gap | **Keep, extend** |

---

## Week 1 — Fix the Foundation (Bugs, Not Features)

### W1-1: Fix modes.ts — Wrong Model
**This is the highest-leverage single change in the entire audit.**

The CLAUDE.md says Claude Sonnet 4.6 + extended thinking. The code says GPT-4o with no extended thinking. Every run in the database was done by GPT-4o. This is why runs complete in 47–95 seconds — no thinking budget, wrong model.

```ts
// lib/agent/modes.ts — current (WRONG)
"research-run": {
  model: "gpt-4o",
  provider: "openai",
  // no thinkingBudget
}

// should be
"research-run": {
  model: "claude-sonnet-4-6",
  provider: "anthropic",
  thinkingBudget: 10000,
}
```

**Files:** `lib/agent/modes.ts`
**Status:** `[ ]`

---

### W1-2: Fix domain-monitor.ts — Generic Query Used for All Domains
Every domain monitor runs: `"latest news analysis developments today from financial markets investing"` regardless of which analyst, which domain, or what strategy. Motley Fool for a momentum trader should use a momentum-specific query.

**Fix:** Each DOMAIN monitor's `config` JSON should include a `searchQuery` field. `domain-monitor.ts` should use `monitor.config.searchQuery` as the Sonar query, falling back to the generic only if absent. The analyst builder must populate `searchQuery` when creating domain monitors.

**Files:**
- `lib/inngest/functions/domain-monitor.ts` — use `monitor.config.searchQuery`
- `components/analysts/AnalystBuilderChat.tsx` or builder tool — generate `searchQuery` per domain

**Status:** `[ ]`

---

### W1-3: Fix deduplicateSignals — 24-Hour Window Too Short
The dedup window is 24 hours. The NVDA/$2B Marvell deal from March 31 is still generating "fresh" signals 2 weeks later because each daily batch doesn't overlap with batches from last week.

**Fix:**
- Dedup window: 7 days for informational signals, 3 days for news, 1 day for BREAKING
- Add a `signal_fingerprint` computed from `(primary_ticker + normalized_headline_topic + signal_week_number)` so the same story across different phrasings gets caught — not just exact headline+summary hashes

**Files:**
- `lib/intelligence/signals.ts` — `deduplicateSignals()`
- Possibly a Prisma migration to add `signalFingerprint` column

**Status:** `[ ]`

---

### W1-4: Fix System Prompt — Discovery Enforcement + manage_position Reference
Two bugs in the current system prompt:

**Bug 1:** Stage 2 says "near max positions: 1–2 highest-conviction only" — this gives the analyst at 3/3 capacity an escape hatch to skip discovery every time. Must change to: "Near max positions means you CANNOT open. It does NOT mean skip discovery research — research 2 new names and add to watchlist."

**Bug 2:** Stage 4 references `manage_position` but that tool may not exist. Verify `lib/agent/tools/` and remove the reference if the tool isn't there, or build it (see W4-1).

**Bug 3:** The `analystPrompt` is injected without framing. Add: "The strategy below is your operating manual, not background reading. Check it before every decision."

**Files:** `lib/agent/system-prompt.ts`

**Note:** Session 1 already improved Stage 2. This task is to apply the remaining Part II fixes on top.

**Status:** `[~]` (partial — session 1 did mandatory holdings + hold warnings, still needs discovery escape hatch fix + manage_position audit + framing header)

---

## Week 2 — Fix the Intelligence Pipeline

### W2-1: Move noveltyScore to Routing Time
**Part II contradicts session 1's approach.** Session 1 computed noveltyScore at signal creation time. Part II says it should be computed at routing time — compare each signal's tickers/themes against signals the analyst has already seen in the past 7 days.

This makes more sense: two analysts can see the same NVDA signal with different novelty scores (one already saw 5 NVDA signals this week, the other is fresh).

**Fix:**
- Revert the `computeNoveltyScore` call from `createSignal()` (or leave it as a baseline, but don't rely on it for routing decisions)
- In `signal-router.ts`: for each (signal, analyst) pair being routed, query recent routes for that analyst in the past 7 days with matching tickers, compute per-analyst novelty score, use it to adjust the relevance score

**Files:**
- `lib/inngest/functions/signal-router.ts` — per-analyst novelty computation in routing loop
- `lib/intelligence/signals.ts` — optionally revert `createSignal` auto-compute

**Status:** `[ ]` (session 1 work in signals.ts needs to be reconsidered)

---

### W2-2: Forced Discovery Slot in Morning Brief
New tickers can only score 35–55 in the router (sector+urgency+keywords, no ticker_match bonus). Existing position tickers score 75–100. So new stocks almost never win the brief's top 3 `newOpportunities` slots.

**Fix:** In `morning-brief-generator.ts`, force at least 1–2 `newOpportunities` to come from signals where the ticker is NOT in the analyst's current positions or watchlist. Pass this as a separate `discoverySignals` array to GPT-4o with explicit instruction: "At least 1 of your newOpportunities MUST come from this discovery list."

**Files:** `lib/inngest/functions/morning-brief-generator.ts` — `buildBriefContext()` + prompt

**Status:** `[ ]`

---

### W2-3: Dynamic Monitor Deduplication
Each briefing creates 0–5 new SEARCH monitors. After 30 runs, potentially 150 new monitors for one analyst. Overlapping topics ("NVIDIA insider selling April 2026" + "NVIDIA insider selling patterns Q2 2026") both run as separate Sonar queries.

**Fix:** Before creating a dynamic monitor in `updateAnalystBriefing`, check if an active analyst-scoped monitor with similar keywords already exists. If a match (>50% keyword overlap), skip creation.

**Files:** `lib/agent/update-analyst-briefing.ts` — before `prisma.monitor.create()` calls

**Status:** `[ ]`

---

### W2-4: Fast-Path Routing for Analyst-Owned Signals
Analyst-owned signals (from domain monitors and strategy search monitors with an `analystId`) currently go through the full routing scoring pass even though they already belong to that analyst. This wastes compute and can produce confusing relevance scores.

**Fix:** In `signal-router.ts`, if `signal.monitorId` maps to a monitor with a non-null `analystId`, fast-path that signal directly to that analyst without scoring (relevanceScore=100, routeReason="owned_monitor").

**Files:** `lib/inngest/functions/signal-router.ts` — add fast-path before main scoring loop (requires loading monitor→analystId mapping)

**Status:** `[ ]`

---

## Week 3 — Fix Analyst Creation

### W3-1: Rebuild the Builder to Generate Operational Playbooks
Current builder produces strategy narrative ("I identify stocks with momentum signals..."). What the agent needs is an operational playbook with specific, machine-readable rules.

**What the builder must elicit:**
1. **Entry criteria** — not "momentum stocks" but "volume 2x+ 5-day avg AND crossed 52w high in past 3 days AND market cap $500M–$50B AND sector = semiconductor/AI hardware"
2. **Entry rules** — "only enter if VIX < 25 and SPY above 20-day MA; never enter within 2 weeks of earnings unless catalyst IS earnings"
3. **Position management rules** — "at +5% move stop to breakeven; at +8% take 25% off; hold rest to target"
4. **Intelligence priorities** — "prioritize in order: (1) insider cluster buying >$5M in 3 days, (2) earnings beat + guidance raise, (3) 52w high breakout on volume. Ignore: single insider sales, analyst downgrades without new information"
5. **Discovery search queries** — "When looking for new names, search for: 'Nasdaq stocks breaking 52-week highs today', 'unusual call option volume technology stocks'"

**What the builder must ask:**
- "What specific setup triggers your interest — price action, news event, earnings beat, insider buying?" → entry criteria
- "How do you know you're wrong — what makes you exit early?" → stop rules
- "What sources do you trust most?" → monitor selection
- "What would you search every morning if doing this manually?" → query design
- "Show me 3 examples of trades you'd want to take" → validate config against real data

**Builder should also** call `get_stock_data` on 2–3 example tickers matching the strategy to validate the config produces sensible signals before finalizing.

**Files:**
- `app/api/agent/[mode]/route.ts` — builder mode system prompt
- `lib/agent/system-prompt.ts` or builder-specific prompt
- `components/analysts/AnalystBuilderChat.tsx` — potentially UI question flow

**Status:** `[ ]`

---

### W3-2: Builder Creates Proper Monitor Configs
When the builder creates monitors, it must:
- For DOMAIN monitors: populate `config.searchQuery` with a domain-specific query based on the analyst strategy (not generic)
- For SEARCH monitors (Tier 2 strategy searches): generate operationally specific queries, not "Tech stock momentum news" but "Nasdaq technology stocks crossing 52-week high this week volume surge"

**Files:**
- Builder tool (`suggest_config` or equivalent) — monitor generation logic

**Status:** `[ ]`

---

## Week 4 — Missing Tools + Behavior Enforcement

### W4-1: Add manage_position Tool
The system prompt (Stage 4) references `manage_position` for updating stops/targets. Need to confirm if this tool exists and is registered.

**Actions:**
1. Check `lib/agent/tools/` for `manage-position.ts`
2. If it exists: verify it's exported from `index.ts` and registered in `tools.ts`
3. If missing: build it with actions: `update_targets`, `move_stop_to_breakeven`, `set_trailing_stop`, `partial_close`
4. Enforce: can't set target/stop that would exceed `maxPositionSize`

**Files:**
- `lib/agent/tools/manage-position.ts` — verify or build
- `lib/agent/tools/index.ts` + `lib/agent/tools.ts` if new
- `lib/agent/modes.ts` — ensure it's in research-run allowlist

**Status:** `[ ]`

---

### W4-2: Hold Duration Enforcement in price-monitor Cron
Analyst configured `holdDurations: ['DAY']` but average hold is 88 hours. Price monitor runs hourly but never closes DAY positions at market close.

**Fix:** At 4 PM ET check, for each analyst with DAY hold duration, identify positions open > 1 trading day. Create a `PositionManagementAction` with `actionType: "HOLD_EXCEEDED"` to flag for next agent run. Optionally auto-close.

**Files:** `lib/inngest/functions/price-monitor.ts`

**Status:** `[ ]`

---

### W4-3: configUpdates Output from Briefing Agent
selfCorrections in the briefing are read back as data — the agent reads them but has no mechanism to change itself. The briefing agent should propose concrete config changes.

**Fix:** Add `configUpdates` to the briefing schema:
```ts
configUpdates: z.array(z.object({
  field: z.enum(["minConfidence", "maxPositionSize", "minSourceQuality", "excludedSourceCategories", "analystPrompt", "holdDurations"]),
  currentValue: z.string(),
  proposedValue: z.string(),
  rationale: z.string(),
}))
```
After generating, apply approved changes to `AgentConfig` (either automatically or via user approval UI).

**Files:**
- `lib/agent/update-analyst-briefing.ts` — add to schema + prompt
- `lib/actions/analyst.actions.ts` — apply config updates
- Possibly a UI approval flow

**Status:** `[ ]`

---

## Month 2 — Close the Learning Loop

### M2-1: Signal-to-Outcome Tracing
No connection between signal quality and trade outcomes. When MU closes for +$504, no signal is credited. When AKAM short fails, no signal is blamed.

**Fix:** When `record_thesis` is called, record which signals (from `read_signals`) were read in the same run. Store as `thesis.sourceSignalIds`. When a position closes, propagate outcome back to those signals' source monitors/queries.

**Files:**
- `lib/agent/tools/record-thesis.ts` — capture signal IDs from run context
- `prisma/schema.prisma` — `thesis.sourceSignalIds String[]`
- `lib/inngest/functions/trade-evaluator.ts` — propagate outcome to signals

**Status:** `[ ]`

---

### M2-2: Source Quality Feedback Loop
A data source that's been wrong 10 times in a row still has `sourceQuality: 3`. Monitors whose searches never led to a winning trade are never deprioritized.

**Fix:** `accuracy-scorer.ts` already computes win rates by signal type. Extend it to trace back to monitor/source and update `sourceQuality` on Signal records and `monitor.enabled` state based on cumulative outcome.

**Files:** `lib/inngest/functions/accuracy-scorer.ts`

**Status:** `[ ]`

---

## The Right Monitor Taxonomy (Reference)

| Tier | Scope | Type | Examples | Owner |
|------|-------|------|----------|-------|
| 1 | FIRM | Always-on market pulse | FMP movers, earnings calendar, "notable tech insider transactions 48h", "unusual options activity tech today" | Firm |
| 2 | ANALYST | Standing strategy searches | Specific to analyst — "Nasdaq tech stocks 52w high volume surge", "semiconductor unusual call options", "earnings beat guidance raise tech this week" | Analyst |
| 3 | ANALYST | Domain crawls with specific queries | Per-domain query derived from analyst strategy | Analyst |
| 4 | FIRM | Per-ticker portfolio/watchlist monitoring | Auto-generated per open position + watchlist item | Firm (per analyst) |
| 5 | ANALYST | Temporary intel | Briefing-agent generated, expires 3–30 days, needs dedup | Analyst |

---

## Session Log

| Session | Date | Work Done | Notes |
|---------|------|-----------|-------|
| Session 1 | 2026-04-15 | P0-A (discovery tagging), P0-B (noveltyScore at creation — may need revision per Part II), P1-A (isDiscovery flag), P1-B (system prompt improvements), P2-B (briefing prompt) | Committed to `claude/fix-report-crashes-Ph7Hz`. Needs review against Part II before relying on. |

---

## Open Questions

1. Does `manage_position` tool actually exist in `lib/agent/tools/`? → Check before W4-1
2. `modes.ts` — confirm exact field names (`thinkingBudget` vs `thinking.budget`) before W1-1
3. Session 1 computed noveltyScore at creation time. Part II says routing time. Should we revert `createSignal` change or keep it as a baseline score that routing can override?
4. noveltyScore at routing time means N×M queries (signals × analysts) per routing run. At 200 signals × 5 analysts = 1000 queries. Need to batch this — query recent routes per analyst once upfront, not per signal.
5. Builder rebuild (W3-1) is a large scope change. Should it be a new builder mode or modify the existing one in place?
