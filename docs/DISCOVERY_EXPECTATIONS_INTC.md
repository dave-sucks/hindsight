# Discovery Run Expectations — INTC via Tech Momentum Trader

**Purpose.** Pre-commit, before tomorrow's Sunday 9am ET weekly discovery cron, exactly what we expect the discovery run to read, decide, and write for one well-supported candidate. After the run we compare the actual ResearchRun / RunMessage / Thesis / ThesisUpdate rows against this doc line by line. Anything that diverges is either a real bug or a documented intentional difference — no more "well maybe that's how it's supposed to work."

This doc covers **one ticker (INTC) on one analyst (Tech Momentum Trader)**. The same discovery run will execute against every non-DAY-only analyst on the account; INTC is the anchor case for verification.

---

## Why INTC, why this analyst

### The signal pool (queried 2026-05-12 from Signal + AnalystSignalRoute)

INTC has the strongest uncovered-by-anyone signal flow on the platform right now:

- **11 routed signals in the past 7 days** (additionally the analyst routing table shows 214 unique INTC routes lifetime for this analyst).
- **5 different analysts** receive at least some INTC signals (so the router is working for this name).
- **Mixed signal types**: NEWS (analyst PT raises, Apple deal, institutional buys), FILING (Q1 earnings beat surge), SECTOR (semi rally + relative-strength critique), MACRO (FMP market-mover roll-ups).
- **Mixed sentiment** — this is the important part. Real-world discovery needs to weigh a bullish-dominant narrative against a credible bearish counter-case. INTC has both, which is exactly the kind of signal mix the four-dimension scoring framework is designed to grade.

Top 6 highest-signal-density INTC items in the 7d window the run will see:

| Signal ID | Date | Type | Sent | Headline (truncated) |
|---|---|---|---|---|
| `cmp1lyh1t000604l4mc2lwzun` | 2026-05-11 | NEWS | BULLISH | Intel Shares Rise on Apple Chip Deal (+7% surge) |
| `cmovdngyj000n04l5rmcj9y7f` | 2026-05-07 | FILING | BULLISH | Q1 earnings beat + Apple talks + SambaNova clearance → +4.5% to $113.01 |
| `cmovdnh0r000o04l5ymrrnny3` | 2026-05-07 | NEWS | BULLISH | Mizuho raises INTC PT $71 → $100 |
| `cmovdnh2r000p04l5ebvgte2x` | 2026-05-07 | NEWS | BULLISH | INTC, AMD, MU hit 52-week highs — INTC up 206% YTD |
| `cmowt44po000l04jx8d72mdz9` | 2026-05-08 | NEWS | BEARISH | Analyst consensus Hold, avg PT $72-80 → 26-37% downside; RSI 85.99 overbought |
| `cmowt44rp000m04jxydlh047a` | 2026-05-08 | NEWS | BEARISH | Intel "minority player in two-horse AI race" vs NVDA/AMD |

Additional bearish counter-signal worth noting: `cmp13zf8a003804l4hk8ms9bj` 2026-05-11 swing-trader watchlist puts INTC on its **bearish** side. Plus several MACRO market-mover roll-ups (FMP) where INTC appears in most-active lists.

### Why **Tech Momentum Trader** (analyst_id `cmmofy6t3000004l7858o1xma`)

Of the 6 enabled analysts, 5 receive INTC routes. Tech Momentum Trader is the right anchor case for these reasons:

- **`directionBias`: LONG only** — kills any ambiguity about the right direction. Agent must mint LONG or pass; no "what if we shorted the AI bubble" digression.
- **`holdDurations`: ["SWING"]** — implies horizon ∈ {TRADE, TARGET}. Cleanly excludes both DAY (skipped from discovery cron after PR #253) and COMPOUNDER.
- **`sectors`: ["Information Technology"]** + **`industries`: ["Semiconductors", "Software", "Technology Hardware, Storage & Peripherals"]** — INTC is squarely in the fence.
- **`themes`: []** — no theme constraint; doesn't artificially privilege AI_CAPEX vs other framings.
- **`signalTypes`: ["MOMENTUM", "VOLATILITY_BREAKOUT", "NEWS_CATALYST", "INSIDER"]** — INTC's signal mix is *exactly* this profile (52w high + Apple catalyst + sector breakout). If discovery passes on INTC for this analyst, the agent is broken.
- **`watchlist`: ["AMD", "NVDA", "MSFT", "FIVN"]** — INTC is NOT on the watchlist. That means discovery will see INTC in the **discovery bucket**, not the watchlist bucket. (Confirmation that the route bucketing logic is correct is part of the test.)
- **`marketCapMin / Max`: null** — no market cap fence to violate.
- **`exclusionList`: ["Low-float speculative stocks"]** — INTC's $184B cap is obviously not in scope.
- **`minConfidence`: 70** — sets the ACTIVE bar. WATCHING can mint below 70.
- **`maxPositionSize`: $2500**, **`maxOpenPositions`: 5** — bounds any place_trade if conviction were high enough.

Tech Momentum Trader's `analystPrompt` lead: *"Capture momentum from stocks making new 52-week highs in the Information Technology sector. The edge is based on the persistence of strength, defying typical mean reversion patterns."* — INTC is *literally* making new 52-week highs.

---

## What the discovery run SHOULD do, step by step

### Step 1 — Read the three discovery surfaces in parallel

The agent's first assistant turn must emit three parallel tool calls (per `lib/agent/system-prompts/discovery.ts` lines 264-282):

1. **`read_signals`** with no args — discovery mode auto-windows the prior 7 days and routes by `routeReasonCode`.
2. **`get_market_movers`** with `scope: "universe"` — top gainers/losers/most-actives minus the coverage set.
3. **`get_earnings_calendar`** with `scope: "universe"` — upcoming earnings prints minus the coverage set.

#### Expected `read_signals` output (Tech Momentum Trader, discovery bucket)

The discovery bucket should contain **at least these INTC signals** (all 11 from the past 7d unless the per-ticker cap MAX_PER_TICKER trims it — likely all surface because INTC carries multi-themed routes):

The 6 signals listed in the table above will all be present, plus the macro most-active roll-ups. Other tickers expected in the same discovery bucket for this analyst (sector/industry-match, not on watchlist, not already covered):
- **TSM** (8 signals — semis, NEWS+SECTOR)
- **DDOG** (4 signals — software, EARNINGS+MACRO+SECTOR)
- **LSCC** (5 signals — semis small-cap, EARNINGS+NEWS)
- **PLTR** (6 signals — software, EARNINGS+NEWS+SECTOR) — bumps against the "Low-float speculative" exclusion only mildly; agent should keep it
- **QCOM** (6 signals — semis, NEWS only)
- **KLAC** (8 signals — semis equipment)

If INTC is NOT in the discovery bucket, that's the first failure point. Likely causes:
- `routeReasonCode` got set to something that triggers WATCHLIST or POSITION bucket (router bug — wouldn't happen because INTC isn't on the watchlist).
- The 7-day lookback default didn't apply (cron not passing `ctx.discoveryOnly`).
- All 11 signals got filtered by `excludedSourceCategories` in intelligence policy (check `intelligencePolicy.excludedSourceCategories`).

The portfolio bucket should be empty (Tech Momentum Trader's open positions: separate query, likely a small set or empty). The watchlist bucket should contain only signals on AMD / NVDA / MSFT / FIVN.

#### Expected `get_market_movers` output (`scope: "universe"`)

Tech Momentum Trader's universe is IT/semis/software/tech-hardware. Most-actives + top-gainers from 2026-05-11 trading day, **excluding** anything in the analyst's coverage set. Should surface INTC if it was a top mover (which it was — see signal `cmp1lyh1t…` "shares surged ~7% on Apple deal"). Same exclusion logic as `read_signals` discovery bucket.

#### Expected `get_earnings_calendar` output (`scope: "universe"`)

The upcoming earnings for IT/semis/software in the analyst's universe, minus coverage. Useful for catalyst-style discovery; INTC's Q1 print already happened on 5/6 so it won't appear here, but TSM / KLAC / DDOG / QCOM / LSCC may.

---

### Step 2 — Research each promising candidate

For INTC specifically, the agent should call (in some order):

1. **`get_theses`** with `tickers: ["INTC"]` — cross-analyst overlap pre-check. **MUST return empty** for INTC (no current ACTIVE/WATCHING thesis on INTC across any analyst on this account, verified by query). If the tool returns any rows, the discovery prompt's pre-check kicks in and the agent should pass on INTC — and we know there's a coverage-state bug.

2. **`get_stock_data`** with `ticker: "INTC"` — this is mandatory before `record_thesis` because the `record_thesis` tool's "researched-before-thesis gate" (record-thesis.ts lines 380-398) rejects any thesis on a ticker that didn't get a `get_stock_data` call in the same run.

#### Expected `get_stock_data` payload (INTC, queried tomorrow)

The agent should extract from this call:
- **Current quote.** Real INTC trades around $108-115 based on the signal timestamps (5/6 close $113.01, 5/7 close $108.21, 5/11 surged ~7%). The exact number tomorrow morning depends on how the price feed reports it. **The agent MUST use this number for `entry_price`** — not invent one, not pull from a signal headline.
- **52-week range.** One signal reports 52w high $114.51. The agent should use a number in this neighborhood for `target_price` (the breakout level — see below).
- **Technicals.** RSI, 20-day SMA, 200-day SMA, 10-day EMA. Multiple bearish signals call out RSI 85.99 and 43.7% above 20-day SMA, 173.7% above 200-day SMA. This MUST land in the scoring rubric's `entryQuality` dimension as a low score — the agent should NOT pretend it's a clean setup.
- **Recent news headlines + analyst targets** — Mizuho $100, Tigress $118, Freedom Broker $100 are bull-side; consensus Hold avg $72-80 is bear-side.

If `get_stock_data` returns a price wildly different from $108-115 (e.g. $40, or $666 like the MU audit), that's a price feed bug — write it down and don't blame the agent.

3. Optionally **`get_earnings_data`** (last EPS print was already covered in the FILING signal; agent may skip).
4. Optionally **`read_artifact`** on the bearish "two-horse race" signal (`cmowt44po…`) for the full Benzinga article — the prompt encourages this when the bearish thesis is non-trivial.
5. Optionally **`web_search`** for fresher color on the Apple deal status (the rationale being it's the dominant near-term catalyst). The discovery run's 25-step budget makes this cheap.

#### Scoring rubric expectation (INTC, Tech Momentum Trader applying its own playbook)

| Dimension | Score | Justification expected in `note` |
|---|---|---|
| `trendStrength` | **3/3** | 458% YTD, multi-month uptrend, rising 50d/200d, 52-week highs. No distribution. |
| `relativeStrength` | **2/3** | Sector-leading move, but AMD up 18% post-earnings outperforms INTC's 4.5% — INTC is strong but not THE leader of the semi cohort. 3 would be reserved for the clear sector leader; 2 is the honest call. |
| `entryQuality` | **0/2 or 1/2** | RSI 85.99 overbought. 43.7% above 20-day SMA. The signal-pool itself warns of "vulnerability to sharp pullbacks." This is a chase. 0 if the agent is rigorous; 1 if it half-credits the Apple-deal catalyst as a fresh entry on news. Anything 2/2 is wrong — this is not a clean defined setup. |
| `catalystFreshness` | **2/2** | Apple chip deal still developing, next earnings 2-3 months out, foundry/AI turnaround narrative still in play. Catalyst is ahead, not behind. |
| **Composite** | **7-8/10** | Sum of caps 3+2+0+2 = 7, or 3+2+1+2 = 8. |

**Composite 7-8 → WATCHING is the right call.** Per the discovery prompt:
- ≥ 8 + clear setup + fresh catalyst → ACTIVE candidate
- ≥ 5 → mint as WATCHING
- The "clear setup" qualifier explicitly rules out ACTIVE because entryQuality is 0-1.

The agent should mint **WATCHING, LONG, TRADE** (or possibly TARGET). It should NOT mint ACTIVE. It should NOT place_trade. The whole point of WATCHING here is "wait for the chase to cool off and re-enter on a clean pullback or fresh breakout."

If the agent mints ACTIVE on INTC with composite 7-8 and entryQuality < 2, that's a prompt-compliance failure.

---

### Step 3 — Mint the thesis

Expected `record_thesis` call shape for INTC. Every field below is either required by the tool, required by a gate, or has a derivable default I'm pre-committing to so we can compare.

```ts
record_thesis({
  ticker: "INTC",
  company_name: "Intel Corporation",
  exchange: "NASDAQ",

  direction: "LONG",
  status: "WATCHING",

  confidence_score: 65-72,    // below the analyst's 70 minConfidence for ACTIVE is FINE on WATCHING

  horizon: "TRADE",            // SWING analyst + tight stop + momentum setup
  max_hold_days: 14,           // REQUIRED for TRADE — 14 is the typical breakout-pattern bound

  // Prices — all from get_stock_data on the run, not invented:
  entry_price: <current INTC quote, expected $108-115>,
  target_price: <breakout level: either 52w high $114.51 OR a level above it like $118-120>,
  stop_loss:   <below entry: 10-day EMA or recent swing low, ~$100-105>,

  // Shape gate (record-thesis.ts validateThesisShape): target > entry > stop. Must hold.
  // R/R sanity (≥ 2:1):  If entry=$110, target=$118, stop=$104  →  reward 8, risk 6  →  R/R 1.33 — REJECT.
  //                      If entry=$110, target=$120, stop=$105  →  reward 10, risk 5  →  R/R 2.0 — OK.
  // Agent must pick numbers that produce R/R ≥ 2:1 or pass.

  // Structural-belief gate (record-thesis.ts validateThesisBelief) — REQUIRED for LONG/SHORT:
  core_belief:
    "Intel's foundry-and-AI turnaround narrative — anchored by the Apple chip deal and the Q1 earnings beat — sustains through the next earnings print, holding the post-Q1 breakout regime.",

  key_assumptions: [
    "Apple chip-supply agreement materializes into a real production contract by FY27 (not just exploratory talks).",
    "Datacenter AI capex environment stays supportive — second-tier semis like INTC continue to capture spillover from NVDA/AMD primary demand.",
    // ≥ 2 required. Third is optional but recommended:
    "Foundry margin trajectory improves on next print (revenue mix shift toward external customers)."
  ],

  invalidation_conditions: [
    "Apple chip deal abandoned, downsized, or assigned to a competitor.",
    "Next earnings (Q2) misses revenue OR guides FY27 below current consensus.",
    // ≥ 2 required. Third is optional but recommended:
    "Stock breaks below 50-day SMA on volume — momentum thesis broken."
  ],

  // Provenance:
  source_kind: "ROUTED_SIGNAL",
  source_signal_ids: [
    "cmp1lyh1t000604l4mc2lwzun",   // Apple deal +7%
    "cmovdngyj000n04l5rmcj9y7f",   // Q1 earnings beat
    "cmovdnh0r000o04l5ymrrnny3",   // Mizuho PT raise
    "cmovdnh2r000p04l5ebvgte2x"    // 52-week high
  ],
  // source_rationale: omitted — ROUTED_SIGNAL doesn't require it (Zod superRefine allows).

  // Scoring:
  scoring: {
    trendStrength:    { score: 3, note: "458% YTD, rising 50d/200d, multi-month uptrend, 52w high $114.51 hit 5/6." },
    relativeStrength: { score: 2, note: "Sector-strong but AMD +18% post-earnings outperforms INTC's +4.5% — strong, not the clear leader." },
    entryQuality:     { score: 0, note: "RSI 85.99, 43.7% above 20d SMA — chasing extended move. No clean pullback yet." },
    catalystFreshness:{ score: 2, note: "Apple deal still developing, next earnings 2-3 months ahead — catalyst is forward, not played." }
  },

  // Free-text:
  reasoning_summary:
    "INTC is making fresh 52-week highs on a confluence of catalysts (Apple chip deal, Q1 beat, foundry/AI turnaround) and is one of the strongest names in a leadership sector. Setup is currently extended (RSI 85+, well above 20d SMA) so this is a watchlist mint — wait for either a pullback to the 20-day or a fresh breakout above $115 on volume before promoting to ACTIVE.",

  thesis_bullets: [
    "Apple chip-supply preliminary agreement (5/8, 5/11 news) — transformative for the foundry business if confirmed.",
    "Q1 earnings beat (5/6 print) drove +4.5% and AI-narrative re-rating; Mizuho raised PT $71 → $100, Tigress to $118.",
    "Sector tailwind: AMD/MU/INTC all hit 52-week highs same day on AI-capex theme — sector strength is real.",
    "But: consensus Hold with avg PT $72-80 — bull case is one-sided; downside if foundry deal slips is sizable.",
    "Entry quality poor at current price (RSI 85.99); watching for pullback to 20-day EMA or breakout-and-hold over $115."
  ],

  risk_flags: [
    "Apple talks are preliminary — material reversal would whip the stock.",
    "Overbought (RSI 85.99) creates pullback vulnerability before any catalyst arrives.",
    "Bear thesis (Benzinga 5/8) — Intel as 'minority player in two-horse AI race' — still has analyst support."
  ],

  signal_types: ["MOMENTUM", "NEWS_CATALYST", "VOLATILITY_BREAKOUT"],

  fundamentals: {
    market_cap: 184_430_000_000,       // from signal cmowt7o6a — ~$184B
    sector: "Information Technology",
    high_52w: 114.51,
    // pe_ratio / beta / avg_volume / low_52w / analyst_consensus: filled from get_stock_data
  }
})
```

**`nextReviewAt` is computed by the tool**, not the agent. With `horizon: "TRADE"` → `HORIZON_REVIEW_DAYS["TRADE"] = 1 day`. Should land at run-start + 24h.

**`triggers[]` is computed by the tool**, merging `defaultTriggersForHorizon("TRADE", { ..., direction: "LONG" }, "WATCHING")` with any agent overrides. Agent should not supply `triggers[]` explicitly — let the defaults flow.

#### Expected triggers attached (auto-merged from `defaultTriggersForHorizon` watching-TRADE-LONG template)

This is what we should see in the persisted `Thesis.triggers` JSONB after the mint succeeds:

1. **ENTER** — `predicate: { kind: "PRICE_ABOVE", level: <target_price> }`, `action: "ENTER"`, cooldownDays 1. This is the level that promotes WATCHING → ACTIVE on the daily run. If target_price is the 52w high ($114.51) or a level above, this is the breakout level.
2. **REVIEW** — `predicate: { kind: "PRICE_BELOW", level: <stop_loss-ish review threshold> }`, cooldownDays 1. Catches "support broke before we ever entered — is the thesis weakening?"
3. **REVIEW** — `predicate: { kind: "TIME_ELAPSED", days: 14 }`, cooldownDays ~11. The max_hold_days time bound for TRADE horizon.
4. **REVIEW** — `predicate: { kind: "REVIEW_DATE_HIT" }`, cooldownDays 1. Hooks off `Thesis.nextReviewAt` for the trigger-evaluator cron's overdue path.
5. **REVIEW** — earnings-based triggers (EARNINGS_BEAT, EARNINGS_MISS minSurprisePct: 3) attached by template.

**What would be WRONG:**
- `target_price = entry_price` (broken — ENTER trigger would fire immediately, MU/MRVL audit bug).
- `target_price < entry_price` for LONG (shape gate would reject — caught upstream).
- `target_price` set to some 52w-low or analyst PT below current price ($72, $80, $100) — the ENTER trigger fires on PRICE_ABOVE; setting it below current means it fires immediately, defeats the purpose.
- ENTER trigger missing (record_thesis "ENTER-trigger guard" lines 689-712 rejects).
- `core_belief` null (belief gate rejects).
- `key_assumptions` or `invalidation_conditions` with < 2 items (belief gate rejects).
- `source_kind: "ROUTED_SIGNAL"` with `source_signal_ids: []` (Zod superRefine rejects).
- `source_signal_ids` containing IDs that aren't in this analyst's routed inbox today (record-thesis.ts lines 451-485 rejects with "not in today's routed inbox").

---

### Step 4 — Cap at 8 new theses

Tech Momentum Trader's universe is rich enough to produce other mints. Realistic expectation: 3-6 new WATCHING theses total for this run (INTC + 2-5 others from TSM/DDOG/LSCC/PLTR/QCOM/KLAC). 8 is the hard cap; the agent should NOT max out unless the week was exceptional.

### Step 5 — `record_run_summary` then `complete_run`

```ts
record_run_summary({
  primary_decision: "WATCH",  // not "ADD" — no place_trade calls if we're right about INTC entryQuality
  ranked_picks: [
    { ticker: "INTC", action: "WATCHING_MINTED", composite: 7-8, ... },
    // ... other minted candidates ...
    // ... and explicit pass notes for any researched-but-not-minted candidates ...
  ],
  decision_rationale:
    "Strong week for IT/semis breakouts — INTC, [others] cleared the WATCHING bar on confluence of AI-capex tailwind, sector strength, and named catalysts. INTC specifically held back from ACTIVE because entry quality is poor (RSI 85+, well above 20d SMA) — waiting for pullback or fresh breakout over $115 on volume. Passed on [X, Y] because [reason]. Next week worth re-evaluating [Z] if Apple-deal news firms up."
})

complete_run()
```

The run should end with `status = "COMPLETE"`. Not FAILED. Not silently terminated mid-stream.

---

## What this run produces in the database

If everything works, after the run we should see:

| Table | Expected rows |
|---|---|
| `ResearchRun` | 1 row, `mode = "DISCOVERY"`, `status = "COMPLETE"`, `agentConfigId = cmmofy6t3000004l7858o1xma`, `parameters.toolStats.byTool` includes read_signals + get_market_movers + get_earnings_calendar + get_theses + get_stock_data + record_thesis + record_run_summary + complete_run, `parameters.tradesPlaced = 0`. |
| `Thesis` | 1 row for INTC with the shape committed above. `status = "WATCHING"`, `coreBelief` non-null, `keyAssumptions` length ≥ 2, `invalidationConds` length ≥ 2, `triggers` JSONB has ≥ 1 ENTER trigger with predicate `PRICE_ABOVE` and `level = targetPrice`, `nextReviewAt` ≈ run_start + 24h. Plus 2-5 similar rows for the other minted candidates. |
| `ThesisUpdate` | 1 `CREATED` row per minted thesis. `signalIds` contains the 4 routed signal IDs from the INTC mint. |
| `RunEvent` | At least: `thesis_complete` events per mint, `run_summary`, `run_complete`. Possibly `briefing_generated` follow-on. |
| `RunMessage` | 1 row, JSON array of UIMessages, contains tool calls in the right Step-1 → Step-2 → Step-3 → Step-5 sequence with narration between (not text-only assistant turns that would terminate the loop). |
| `AnalystSignalRoute` | The 4 cited INTC signal IDs flip from `READ` → `ACTED_ON` (record-thesis.ts lines 1095-1107). |
| `Position` | No new rows for INTC (WATCHING, not traded). |
| `TradeDecision` | No INTC row (no place_trade). |

---

## Specific things to watch for as failures

Listed in pipeline order. If any of these are observed in tomorrow's data, write down which one and we go fix it before moving on:

1. **Discovery run ends in `status = FAILED` with zero theses.** This was the 2026-05-10 outage. PR #253 fixed the root causes; verifying it stuck is half the point of tomorrow's run.

2. **`read_signals` returns zero INTC signals in the discovery bucket.** Means either the 7d lookback isn't applied, the router isn't running, or the route bucketing is wrong. Cross-check by querying `AnalystSignalRoute` directly for analystId + INTC signalIds.

3. **`get_stock_data` returns a price outside $90-130 for INTC.** Price feed bug. Compare against the signal-embedded prices ($108.21 / $113.01 / $114.51) and against any real-world INTC quote.

4. **INTC thesis minted with `coreBelief = null`.** The belief gate is supposed to catch this. If it lands, the gate is broken or being bypassed.

5. **INTC thesis minted with `target_price ≤ entry_price` (LONG shape inverted).** The shape gate is supposed to catch this. If it lands, the gate is broken or being bypassed.

6. **INTC thesis minted with `target_price = entry_price`** (ENTER fires immediately). Shape gate rejects equal levels per validateThesisShape; verify by reading the implementation.

7. **INTC thesis minted as `status = ACTIVE` with `entryQuality = 0` or `1`.** Composite 7 with entryQuality < 2 should be WATCHING, not ACTIVE — explicit in the prompt's threshold section.

8. **INTC thesis minted with empty `triggers[]` JSONB.** The ENTER-trigger guard is supposed to catch this. If it lands, default merge didn't run.

9. **`source_kind: "ROUTED_SIGNAL"` with `source_signal_ids: []`** — should be Zod-rejected. If it lands, schema validation is being skipped.

10. **`source_signal_ids` contains IDs that don't exist in `AnalystSignalRoute` for this analyst today** — should be rejected at lines 451-485. If it lands, validation skipped.

11. **Agent narrates "I'll proceed to research..." and then terminates the loop without calling a tool.** This was the May 7 morning-cron failure mode (premature exit). The "tool-call discipline" block in the prompt should prevent it; if it happens we know the block isn't load-bearing.

12. **Run completes but `record_run_summary` was never called** — the run's `parameters.toolStats.byTool` won't have it. Means the workflow truncated.

13. **`AnalystSignalRoute` rows for the cited signalIds don't flip to `ACTED_ON`** — record-thesis.ts post-write step failed silently.

14. **Cross-analyst overlap rejection on INTC despite no existing coverage** — false positive in the same-direction guard. Would mean some other analyst's discovery run beat Tech Momentum Trader to INTC; check the run order in the cron, the Inngest concurrency settings, and what `get_theses tickers:["INTC"]` returns.

---

## Calibration: what would be GOOD ENOUGH

The user's framing for this stage: *"ignoring the quality of discovery which has tons of issues. Just starting with a discovery run and seeing if it at least pulls the right things in and sets theses the right way."*

So the bar for "Stage A passes for tomorrow's INTC trace":

✅ Discovery run completes (not FAILED).
✅ INTC thesis exists with status=WATCHING, direction=LONG, all required fields populated, default triggers attached, ENTER trigger has a real `level` value that's above the entry price, `source_kind=ROUTED_SIGNAL` with real signal IDs from the analyst's inbox, scoring breakdown present.
✅ ThesisUpdate(CREATED) row exists with signalIds populated.
✅ Run ends with `record_run_summary` + `complete_run`.

The thesis prose can be mediocre. The scoring can be slightly off (e.g. entryQuality=1 when I expected 0). The horizon can be TARGET instead of TRADE. None of that is the immediate concern — the immediate concern is that the *shape* of the thing the run produces matches the design, not the *quality* of its analysis.

Quality issues that we explicitly defer (per the user's note):
- The trader-prompt "core thesis" is sometimes generic/derivative.
- Composite scoring rubric is calibrated for momentum but applied universally (PR #253 GAPS.md P1-9).
- The agent occasionally writes thesis_bullets that just restate the headline summary instead of synthesizing.

Those go on the Stage A v2 list. We're verifying mechanics this pass.
