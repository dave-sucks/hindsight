# Agent Tool Refactor Proposal

## The Problem

Runs stall every day. The root cause is structural: the tools were built incrementally as a rigid pipeline, not as a flexible toolkit an agent can compose. The system prompt forces a 6-phase waterfall with mandatory tool calls at each phase. The math doesn't work — a standard 4-ticker run needs 33+ tool steps but the ceiling is 30. The Finnhub rate limit is 60 calls/min but a standard run makes 120+. Tools duplicate each other's work, return bloated payloads, and the agent has zero autonomy in how it uses them.

### Current API Call Budget (Standard 4-Ticker Run)

| Phase | Tool | Finnhub | FMP | Other | Total |
|-------|------|---------|-----|-------|-------|
| 1 | get_market_overview | 25 | 1 | 0 | 26 |
| 1.5 | detect_market_themes | 12 | 0 | 1 | 13 |
| 1.75 | scan_catalysts | 1 | 3 | 0 | 4 |
| 2 | scan_candidates (+ quality filter) | 21 | 2 | 2 | 25 |
| 3 | get_stock_data × 4 | 20 | 0 | 0 | 20 |
| 3 | get_technical_analysis × 4 | 4 | 0-4 | 0-4 | 4-12 |
| 3 | get_reddit_sentiment × 4 | 0 | 0 | 4 | 4 |
| 3 | get_twitter_sentiment × 4 | 0 | 4 | 4 | 8 |
| 3 | get_earnings_data × 4 | 8 | 0 | 0 | 8 |
| 4 | show_thesis × 4 | 0 | 0 | 0 | 0 |
| 5 | place_trade × 2 | 0 | 0 | 6 | 6 |
| 6 | summarize_run | 0 | 0 | 0 | 0 |
| **Total** | | **91** | **10-14** | **17-21** | **118-134** |

At 60 Finnhub calls/min, that's ~1.5 minutes of API calls alone — in a 120-second window.

### Current Tool Step Budget

| Phase | Steps Used |
|-------|-----------|
| Discovery (overview, themes, catalysts, scan) | 4 |
| Deep Research (4 tickers × 5 core tools each) | 20 |
| Thesis (4 × show_thesis) | 4 |
| Trade (2 × place_trade) | 2 |
| Summary (summarize_run) | 1 |
| **Total** | **31** (exceeds 30-step limit) |

This doesn't include any optional tools (peers, SEC, options, news deep dive, analyst targets). Adding even one optional tool per ticker pushes it to 35+.

### Duplicated Data Across Tools

| Data | Fetched By | Times Fetched |
|------|-----------|---------------|
| 11 Sector ETF quotes | get_market_overview, detect_market_themes | 2× |
| Earnings calendar | get_market_overview, scan_candidates, scan_catalysts | 3× |
| Economic calendar | get_market_overview, scan_catalysts | 2× |
| Company profile + metrics | scan_candidates (quality filter), get_stock_data | 2× per ticker |
| Stock news | get_stock_data (Finnhub), get_news_deep_dive (FMP) | 2× per ticker |
| Reddit trending | detect_market_themes, scan_candidates | 2× |

---

## Design Principles (What Good Tool Systems Do)

### 1. Tools Are Capabilities, Not Pipeline Steps
The best agent tool systems (Exa, Anthropic's own recommendations, OpenAI's docs) treat tools as **atomic capabilities** the agent can invoke in any order, any combination, or skip entirely. Tools should be like Unix commands — small, composable, no opinions about workflow.

**Current problem:** Your tools ARE the pipeline. The system prompt says "call these in this exact order." That's not an agent — that's a script with an LLM in the middle.

### 2. One Tool = One Concern
Each tool should do one thing and return a focused result. Not "get stock data + news + analyst consensus + financials" — that's 4 concerns.

**Current problem:** `get_stock_data` fetches quote + profile + metrics + news + recommendations. `get_market_overview` fetches SPY + VIX + 11 sectors + candles + macro events + earnings density.

### 3. Return Payloads Should Be Minimal
The tool result goes into the LLM's context window. Every token of tool output is a token that can't be used for reasoning. Return only what the agent needs to make decisions.

**Current problem:** `show_thesis` returns `{ ...args, thesis_id }` — echoing back EVERYTHING the agent just sent. `_sources` arrays on every tool add hundreds of tokens.

### 4. Let the Agent Compose, Don't Pre-Compose
Instead of one tool that fetches 5 things, give the agent 5 fast tools and let it decide what it needs. Some tickers only need a quote + technicals. Others need the full deep dive.

**Current problem:** The system prompt mandates `get_stock_data` + `get_technical_analysis` + `get_reddit_sentiment` + `get_twitter_sentiment` for EVERY ticker. That's 4 mandatory calls even for a ticker the agent is going to PASS on after seeing the quote.

### 5. Cache and Share Data Between Tools
If tool A fetches data that tool B also needs, don't fetch it again. Use a run-scoped cache.

**Current problem:** Zero caching. Module-level `next: { revalidate: 300 }` doesn't work in API routes.

---

## Proposed New Tool Set: 10 Tools (Down from 18)

### Tier 1: Market Context (1 tool, currently 3)

#### `read_market` (replaces get_market_overview + detect_market_themes + scan_catalysts)

**Rationale:** These three tools are ALWAYS called together at the start of every run. They fetch overlapping data (sector ETFs fetched twice, earnings calendar three times, economic calendar twice, Reddit trending twice). Merge them into a single discovery tool.

**Parameters:**
```typescript
z.object({
  include_themes: z.boolean().optional().default(true),
  include_catalysts: z.boolean().optional().default(true),
})
```

**Returns:**
```typescript
{
  regime: "RISK_ON" | "RISK_OFF" | "NEUTRAL",
  spy: { price, change_pct, trend: "above_sma20" | "below_sma20" },
  vix: { level, change_pct },
  sectors: [{ symbol, change_pct, momentum? }],  // 11 items
  macro_events: [{ event, impact }],              // HIGH only, max 5
  themes?: [{ name, strength, direction, tickers }],  // max 3
  catalysts?: {
    earnings_next_3d: [{ ticker, date, eps_est }],  // max 10
    insider_clusters: [{ ticker, details }],         // max 5
    upgrades: [{ ticker, firm, action }],            // max 5
  },
  earnings_density: { count, period },
}
```

**API calls saved:** ~22 Finnhub calls (11 duplicate sector quotes + 11 sector candles eliminated) + 2 duplicate earnings calendar + 1 duplicate econ calendar + 1 duplicate Reddit trending = **~26 fewer API calls per run**.

**Steps saved:** 2 (was 3 tools, now 1).

---

### Tier 2: Discovery (1 tool, currently 1 but cheaper)

#### `scan_candidates` (streamlined)

**Changes:**
- Drop the quality filter entirely (profile + metrics fetch for 8 candidates = 16-24 Finnhub calls). Let the agent discover quality issues when it calls `get_quote` during research. If a ticker is garbage, the agent will see it and skip.
- Accept `theme` parameter from read_market output.
- Return max 8 candidates with score + sources only. No metrics, no profiles.

**Parameters:**
```typescript
z.object({
  theme: z.string().optional(),
  sectors: z.array(z.string()).optional(),
  min_score: z.number().optional().default(2),
})
```

**Returns:**
```typescript
{
  candidates: [{ ticker, score, sources: string[], volume_spike?: boolean }],
  total_scanned: number,
}
```

**API calls saved:** ~20 Finnhub calls (quality filter + profile fetch eliminated).

---

### Tier 3: Per-Ticker Research (5 tools, currently 10)

The agent should be able to go as shallow or deep as it wants on any ticker. Give it a fast quote tool for quick checks, and deeper tools it can call if it's interested.

#### `get_quote` (new — lightweight entry point)

The most important change. Currently, to get a stock's price the agent must call `get_stock_data` which makes 5 API calls and returns 1400 tokens. Give it a 1-call tool that returns 200 tokens.

**Parameters:**
```typescript
z.object({
  ticker: z.string(),
})
```

**Returns:**
```typescript
{
  price: number,
  change_pct: number,
  name: string,
  sector: string,
  market_cap: number,
  pe_ratio: number | null,
  // Agent can decide: is this worth researching deeper?
}
```

**API calls:** 2 Finnhub (quote + profile2). The profile2 endpoint includes market cap.

**Why this matters:** The agent can now "peek" at a ticker for 2 API calls and 200 tokens. If it's a micro-cap junk stock, it skips immediately instead of spending 5 calls + 1400 tokens on the full get_stock_data.

#### `analyze_stock` (replaces get_stock_data + get_technical_analysis)

Merges fundamentals + technicals into one deep-dive tool. One tool call, one step.

**Parameters:**
```typescript
z.object({
  ticker: z.string(),
  include_technicals: z.boolean().optional().default(true),
  include_news: z.boolean().optional().default(false),
})
```

**Returns:**
```typescript
{
  quote: { price, change_pct, high, low, volume_ratio },
  company: { name, sector, market_cap, exchange },
  financials: { pe, pb, beta, high_52w, low_52w },
  analyst_consensus: { buy, hold, sell },
  technicals?: {
    rsi_14, sma_20, sma_50, trend,
    position_in_range: "72%",
  },
  news?: [{ headline, source, date }],  // max 3, headlines only, no summaries
}
```

**API calls:** 5-7 Finnhub (quote + profile + metrics + recommendations + candles). Only adds news (1 more) or technicals (1 more) if requested.

**Steps saved:** 1 per ticker (was 2 tools, now 1). For 4 tickers = 4 steps saved.

#### `get_sentiment` (replaces get_reddit_sentiment + get_twitter_sentiment)

Merge social sentiment into one call. Reddit + StockTwits + FMP social in parallel.

**Parameters:**
```typescript
z.object({
  ticker: z.string(),
})
```

**Returns:**
```typescript
{
  reddit: { mentions, sentiment, trending, top_posts: [{ title, score, subreddit }] },
  stocktwits: { mentions, sentiment, trending, watchlist_count },
  overall: "bullish" | "bearish" | "neutral" | "no_data",
}
```

**API calls:** Same total (Reddit + StockTwits + FMP) but in one step instead of two.

**Steps saved:** 1 per ticker. For 4 tickers = 4 steps saved.

#### `get_earnings` (unchanged, already efficient)

Keep as-is. 2 Finnhub calls, lean return. Rename from `get_earnings_data` to `get_earnings`.

#### `deep_dive` (replaces get_news_deep_dive + get_sec_filings + get_analyst_targets + get_company_peers + get_options_flow)

A single "go deeper" tool the agent can call when it wants more signal on a specific ticker. It fetches the expensive/optional data.

**Parameters:**
```typescript
z.object({
  ticker: z.string(),
  include: z.array(z.enum([
    "news",        // FMP stock news + press releases
    "filings",     // SEC EDGAR
    "targets",     // FMP analyst price targets
    "peers",       // Finnhub peers + comparison
    "options",     // FMP/Finnhub options flow
  ])).describe("Pick only what you need for this specific ticker"),
})
```

**Returns:** Only the sections the agent requested. Each section is a compact summary.

```typescript
{
  news?: [{ headline, source, date }],         // max 5, no 500-char summaries
  filings?: [{ type, date, description }],     // max 5
  targets?: { consensus, high, low, analysts },
  peers?: [{ ticker, pe, change_pct }],        // max 3
  options?: { put_call_ratio, signal, unusual_count },
}
```

**Why this matters:** Currently these are 5 separate tools = 5 steps each. The agent rarely needs ALL of them for any single ticker. With `deep_dive`, it's 1 step and it picks exactly what it needs. An earnings play? `include: ["earnings", "news"]`. A technical breakout? Skip deep_dive entirely. An insider buying signal? `include: ["filings", "targets"]`.

**Steps saved:** Up to 4 per ticker when multiple optional tools would have been called.

---

### Tier 4: Actions (3 tools, currently 3 — but fixed)

#### `show_thesis` (fixed return payload)

**Change:** Stop returning `{ ...args, thesis_id }`. Return only:
```typescript
{
  thesis_id: string,
  ticker: string,
  direction: "LONG" | "SHORT" | "PASS",
  confidence: number,
}
```

**Token savings:** ~500-800 tokens per thesis call. For 4 tickers = 2000-3200 tokens saved.

Also fix:
- `modelUsed: "gpt-4.1"` (currently hardcoded as "gpt-4o")
- Wrap thesis + event + trade decision in a transaction
- Simplify `sources_used` schema to `z.array(z.string())` (e.g., `["Finnhub Quote", "Reddit r/wsb", "FMP Analyst Targets"]`)

#### `place_trade` (fixed: no fill wait)

**Change:** Stop polling Alpaca for 10 seconds. Fire-and-forget:
1. Place Alpaca order
2. Record trade in DB immediately with `status: "PENDING"`
3. Return instantly
4. Let the price-monitor cron detect the fill and update the record

```typescript
// Returns immediately:
{
  trade_id: string,
  ticker: string,
  status: "placed",
  shares: number,
}
```

**Time saved:** Up to 10 seconds per trade. For 2 trades = 20 seconds back in the agent's time budget.

Also fix:
- Stop returning `{ ...args, ... }` — return only the 4 fields above
- Fix the `position.id` / `dbOrder.id` references that may reference undefined variables

#### `summarize_run` (fixed schema + return)

**Changes:**
- Add `"PASS"` to `ranked_picks[].direction` enum (currently only LONG/SHORT, causing schema validation failures when agent includes pass tickers)
- Return only `{ status: "complete", analyzed: number, traded: number }`
- Make the DB update idempotent (check status before updating)

---

### Tier 5: Topic Search (1 tool, keep as-is)

#### `search_reddit` (unchanged)

Broad topic search. Fine as-is.

---

## New Tool Set Summary

| # | Tool | Replaces | API Calls | Steps |
|---|------|----------|-----------|-------|
| 1 | `read_market` | get_market_overview + detect_market_themes + scan_catalysts | ~20 | 1 |
| 2 | `scan_candidates` | scan_candidates (streamlined) | ~7 | 1 |
| 3 | `get_quote` | (new, lightweight) | 2 | 1 per peek |
| 4 | `analyze_stock` | get_stock_data + get_technical_analysis | 5-7 | 1 per ticker |
| 5 | `get_sentiment` | get_reddit_sentiment + get_twitter_sentiment | 3 | 1 per ticker |
| 6 | `get_earnings` | get_earnings_data | 2 | 1 per ticker |
| 7 | `deep_dive` | get_news_deep_dive + get_sec_filings + get_analyst_targets + get_company_peers + get_options_flow | 1-7 | 1 per ticker |
| 8 | `show_thesis` | show_thesis (fixed) | 0 | 1 per ticker |
| 9 | `place_trade` | place_trade (fixed) | 1 | 1 per trade |
| 10 | `summarize_run` | summarize_run (fixed) | 0 | 1 |

### New Standard Run Budget (4 tickers, 2 trades)

| Phase | Tool Calls | Steps | API Calls |
|-------|-----------|-------|-----------|
| Discovery | read_market + scan_candidates | 2 | ~27 |
| Quick Check | get_quote × 6 (peek at 6, research 4) | 6 | 12 |
| Deep Research | analyze_stock × 4 | 4 | 24 |
| Sentiment | get_sentiment × 4 | 4 | 12 |
| Optional | deep_dive × 2 (only for top picks) | 2 | 6 |
| Thesis | show_thesis × 4 | 4 | 0 |
| Trade | place_trade × 2 | 2 | 2 |
| Summary | summarize_run | 1 | 0 |
| **Total** | | **25** | **~83** |

**Steps: 25 of 30** (5 steps of headroom for get_earnings or extra deep_dives)
**Finnhub calls: ~60** (right at the 60/min budget)
**Run time saved: ~30-40 seconds** (no fill wait, fewer API calls, no redundant fetches)

Versus current:
- Steps: 31+ (exceeds limit)
- Finnhub calls: ~120+ (2× over budget)
- Constant 429s and timeouts

---

## System Prompt Changes

The current system prompt is a 210-line rigid pipeline. Replace it with:

### Philosophy Change
- Remove numbered phases. Let the agent decide its own workflow.
- Define WHAT it must produce (theses for researched tickers, trades above confidence, a summary), not HOW to get there.
- Give it guidelines, not a script.

### Key Rules (keep these):
- Must call `show_thesis` for every ticker it researches (even PASS)
- Must call `place_trade` for every thesis above confidence threshold
- Must call `summarize_run` as its final action
- Must not duplicate positions
- Must cite sources

### Remove these mandates:
- "Call get_market_overview first"
- "Then call detect_market_themes"
- "Then call scan_catalysts"
- "For each candidate, call get_stock_data, then get_technical_analysis, then get_reddit_sentiment, then get_twitter_sentiment"
- "Social sentiment is critical — always check BOTH Reddit AND Twitter"

### Replace with:
- "Start by understanding the market. `read_market` gives you regime, themes, and catalysts in one call."
- "Use `get_quote` to quickly screen candidates. Only call `analyze_stock` on tickers worth researching."
- "You decide how deep to go on each ticker. Not every stock needs sentiment data or options flow. Use your judgment."
- "You have 30 tool steps. Budget them wisely — 2 for discovery, ~5 per ticker you research deeply, and save 1 for summarize_run."

---

## Infrastructure Fixes

### 1. Run-Scoped API Cache
Create a simple in-memory cache scoped to the tool context:

```typescript
interface ToolContext {
  runId: string;
  userId: string;
  analystId?: string;
  cache: Map<string, { data: unknown; timestamp: number }>;
  apiStats: { finnhub: number; fmp: number; errors: number };
}
```

The `finnhub()` and `fmp()` helpers check the cache before making a request. TTL of 5 minutes (covers the entire run). This prevents duplicate fetches across tools.

### 2. Remove `next: { revalidate: 300 }`
This does nothing in API routes. Remove it from all fetch calls.

### 3. Cache SEC Tickers JSON
Store in module-level variable after first download. The company_tickers.json file doesn't change within a run.

### 4. Shared API Helpers
Move `finnhub()`, `fmp()`, and the retry logic into `lib/api/finnhub.ts` and `lib/api/fmp.ts`. Currently duplicated across tools.ts, themes.ts, and catalysts.ts (3 copies of finnhubFetch, 2 copies of fmpFetch). Share a single implementation with shared rate limit tracking.

---

## Urgent Fixes (Do Now, Before Full Refactor)

These 5 changes can be made to the CURRENT tools.ts to unblock runs immediately:

### Fix 1: Add "PASS" to summarize_run direction enum
```diff
- direction: z.enum(["LONG", "SHORT"]),
+ direction: z.enum(["LONG", "SHORT", "PASS"]),
```
Without this, the agent's summarize_run call fails schema validation when it includes PASS tickers in ranked_picks, and the run never completes.

### Fix 2: Stop echoing args back from show_thesis, place_trade, summarize_run
```diff
// show_thesis
- return { ...args, thesis_id: thesis.id };
+ return { thesis_id: thesis.id, ticker: args.ticker, direction: args.direction, confidence_score: args.confidence_score };

// place_trade success
- return { ...args, status: "filled", fill_price, ... };
+ return { status: "filled", trade_id: trade.id, ticker: args.ticker, fill_price, shares: args.shares };

// place_trade failure
- return { ...args, status: "failed", error: msg, ... };
+ return { status: "failed", ticker: args.ticker, error: msg };

// summarize_run
- return args;
+ return { status: "complete", analyzed: args.ranked_picks.length, traded };
```

### Fix 3: Drop sector candle fetches from get_market_overview
Delete the entire "Sector momentum (10-day SMA)" block (lines ~561-598). This saves 11 Finnhub calls and ~2 seconds per run. The daily change% from the quote is sufficient.

### Fix 4: Remove news from get_stock_data (let agent use get_news_deep_dive)
```diff
- const [quoteResult, profileResult, financialsResult, newsResult, recsResult] =
-   await Promise.all([
-     finnhub(`/quote?symbol=${ticker}`),
-     finnhub(`/stock/profile2?symbol=${ticker}`),
-     finnhub(`/stock/metric?symbol=${ticker}&metric=all`),
-     finnhub(`/company-news?symbol=${ticker}&from=...`),
-     finnhub(`/stock/recommendation?symbol=${ticker}`),
-   ]);
+ const [quoteResult, profileResult, financialsResult, recsResult] =
+   await Promise.all([
+     finnhub(`/quote?symbol=${ticker}`),
+     finnhub(`/stock/profile2?symbol=${ticker}`),
+     finnhub(`/stock/metric?symbol=${ticker}&metric=all`),
+     finnhub(`/stock/recommendation?symbol=${ticker}`),
+   ]);
```
Saves 1 Finnhub call per ticker (4 per run) and ~400 tokens per ticker.

### Fix 5: Relax the system prompt
Change the system prompt to stop mandating tool order. At minimum:
- Remove "always check BOTH Reddit AND Twitter" — let the agent decide
- Remove Phase 1.5 and 1.75 as mandatory — make them optional
- Add: "You have 30 steps. Budget wisely. Not every ticker needs every tool."

---

## Migration Path

### Week 1: Urgent Fixes (unblock runs)
Apply Fixes 1-5 above. Runs should start completing again.

### Week 2: Consolidate Discovery
Merge get_market_overview + detect_market_themes + scan_catalysts → `read_market`. Update system prompt.

### Week 3: Consolidate Per-Ticker Tools
- Add `get_quote` (new lightweight tool)
- Merge get_stock_data + get_technical_analysis → `analyze_stock`
- Merge get_reddit_sentiment + get_twitter_sentiment → `get_sentiment`
- Merge 5 optional tools → `deep_dive`

### Week 4: Fix Actions + Infrastructure
- Fix show_thesis, place_trade, summarize_run payloads
- Add run-scoped cache
- Shared API helpers
- Rewrite system prompt to be guidance-based, not pipeline-based
