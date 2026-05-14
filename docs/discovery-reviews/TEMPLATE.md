# Discovery Run Expectations — TICKER via ANALYST NAME

> **Naming convention:** `YYYY-MM-DD-TICKER.md` — the date the review was written (pre-run),
> the anchor ticker being verified. One file per run/ticker pairing.

**Purpose.** Pre-commit, before the next manual or scheduled discovery cron run, exactly what
we expect Discovery to read, decide, and write for one well-supported candidate. After the run
we compare the actual ResearchRun / RunMessage / Thesis / ThesisUpdate rows against this doc
line by line. Anything that diverges is either a real bug or a documented intentional difference.

---

## Why TICKER, why this analyst

### The signal pool

Summary of the signals driving this review. Include:
- Number of routed signals in the past 7 days
- How many analysts receive signals for this ticker
- Signal types present (NEWS, FILING, SECTOR, MACRO, etc.)
- Mixed vs unanimous sentiment — the important dimension for scoring

List the top 5-6 signals with: Signal ID, date, type, sentiment, truncated headline.

### Why this analyst

Bullet-list: directional bias (LONG-only?), hold durations (SWING?), sectors/industries
(in-fence?), themes, watchlist (is TICKER already covered?), marketCap bounds,
exclusionList, minConfidence, analystPrompt alignment.

---

## What the discovery run SHOULD do, step by step

### Step 1 — Read the three discovery surfaces in parallel

Expected first assistant turn: three parallel tool calls per `lib/agent/system-prompts/discovery.ts`.

1. **`read_signals`** — discovery mode, 7-day window, routeReasonCode-based bucketing
2. **`get_market_movers`** with `scope: "universe"` — top gainers/losers/most-actives minus coverage
3. **`get_earnings_calendar`** with `scope: "universe"` — upcoming earnings minus coverage

**Expected `read_signals` discovery bucket content:** name the tickers expected and why.
If TICKER is NOT in the discovery bucket, list likely failure causes.

### Step 2 — Research TICKER

Tool sequence expected (in some order):

1. **`get_theses`** with `tickers: ["TICKER"]` — cross-analyst overlap pre-check. Must return
   empty if no existing coverage.
2. **`get_stock_data`** with `ticker: "TICKER"` — mandatory before `record_thesis`
   (researched-before-thesis gate). List expected payload: current quote range, 52w range,
   technicals (RSI, SMAs), news headlines, analyst targets.
3. (Optional) `get_earnings_data`, `read_artifact`, `web_search`

**Scoring rubric expectation:**

| Dimension | Score | Justification |
|-----------|-------|---------------|
| `trendStrength` | /3 | |
| `relativeStrength` | /3 | |
| `entryQuality` | /2 | |
| `catalystFreshness` | /2 | |
| **Composite** | /10 | |

**Expected outcome from composite:** WATCHING (≥5) / ACTIVE (≥8 + clean setup) / PASS (<5).

### Step 3 — Mint the thesis

Pre-committed `record_thesis` call shape. Fill every required field:

```ts
record_thesis({
  ticker: "TICKER",
  direction: "LONG" | "SHORT",
  status: "WATCHING",
  confidence_score: <range>,
  horizon: "TRADE" | "TARGET" | "CATALYST" | "COMPOUNDER",
  max_hold_days: <N>,  // REQUIRED for TRADE

  entry_price: <from get_stock_data>,
  target_price: <from analysis>,
  stop_loss: <from analysis>,
  // R/R sanity: ≥ 2:1 required or tool rejects

  core_belief: "<ONE sentence: what will happen and why>",
  key_assumptions: [
    "<falsifiable premise 1>",
    "<falsifiable premise 2>",
  ],
  invalidation_conditions: [
    "<concrete thing that disproves the belief 1>",
    "<concrete thing that disproves the belief 2>",
  ],

  source_kind: "ROUTED_SIGNAL",
  source_signal_ids: ["<id1>", "<id2>"],

  scoring: {
    trendStrength:    { score: N, note: "..." },
    relativeStrength: { score: N, note: "..." },
    entryQuality:     { score: N, note: "..." },
    catalystFreshness:{ score: N, note: "..." }
  },

  reasoning_summary: "...",
  thesis_bullets: ["...", "...", "...", "...", "..."],
  risk_flags: ["...", "...", "..."],
  signal_types: ["MOMENTUM", "NEWS_CATALYST", ...]
})
```

**Expected triggers attached (auto-merged from `defaultTriggersForHorizon`):**
List the expected trigger predicates — ENTER, EXIT, REVIEW types.

**What would be WRONG:** list shape-gate and belief-gate violations to watch for.

### Step 4 — Cap and wrap

Expected total new WATCHING theses: N–M (including TICKER + other in-universe names).
Expected PASS+ARCHIVED rows: N–M (researched-but-declined, each with reasoningSummary + ≥1 invalidation_condition).

### Step 5 — `record_run_summary` then `complete_run`

Expected `primary_decision`, `ranked_picks` shape, `decision_rationale`. Run must end
`status = "COMPLETE"`.

---

## What this run produces in the database

| Table | Expected rows |
|-------|---------------|
| `ResearchRun` | 1 row, `mode="DISCOVERY"`, `status="COMPLETE"`, `parameters.tradesPlaced=0` |
| `Thesis` — TICKER | 1 row: direction, status, coreBelief non-null, keyAssumptions ≥2, invalidationConds ≥2, triggers has ≥1 ENTER |
| `Thesis` — others | N–M more WATCHING rows for in-universe names |
| `Thesis` — PASS rows | N–M PASS+ARCHIVED rows with reasoningSummary + ≥1 invalidation_condition |
| `ThesisUpdate` | 1 CREATED row per minted thesis |
| `RunEvent` | thesis_complete events, run_summary, run_complete |
| `Position` | No new rows (Discovery doesn't trade) |

**Server-derived run summary (from ThesisUpdate WHERE runId):**
- Added to watchlist: N–M
- Researched, passed: N–M
- All other buckets: empty

---

## Specific failures to watch for

Numbered list of concrete failure modes in pipeline order. For each:
- What it looks like in the data
- Likely root cause (bucketing, gate, prompt compliance, feed issue)
- How to distinguish from correct behavior

---

## Calibration: what would be GOOD ENOUGH

One paragraph defining the minimum bar for "mechanics pass, quality deferred." Shape of
the thing produced, not the quality of the analysis.

Quality issues to explicitly defer (list them).
