# Agent Research Pipeline Fix Plan

## Problems Identified

### P1: FMP API URLs have double API key (CRITICAL — breaks market data + movers)
**File**: `lib/agent/tools.ts`

The `fmp()` helper already appends `?apikey=KEY` to every URL, but two calls manually include it:
- `get_market_overview` sectors: `fmp("/quote/XLK,XLF,...?apikey=" + FMP_KEY)` → URL becomes `...?apikey=KEY&apikey=KEY`
- `scan_candidates` movers: `fmp("/stock_market/actives?apikey=" + FMP_KEY)` → same double-key problem

**Result**: Sectors and movers return `null`. The market context card is empty, and scan_candidates only finds earnings (no movers). This is why screenshot 3 shows "Range-Bound" with no SPX/VIX/sectors, and only earnings chips in the scan card.

**Fix**: Remove the manual `?apikey=` from both calls. Change to:
- `fmp("/quote/XLK,XLF,XLV,XLY,XLP,XLE,XLI,XLB,XLRE,XLU,XLC")`
- `fmp("/stock_market/actives")`

### P2: VIX quote URL may not work with FMP
**File**: `lib/agent/tools.ts`

`fmp("/quote/%5EVIX")` — FMP might not support `^VIX` directly. The correct FMP symbol for VIX could be `VIXY` (VIX ETF) or we should use Finnhub for VIX instead.

**Fix**: Try Finnhub for VIX: `finnhub("/quote?symbol=^GSPC")` for S&P, or use FMP's `/market-risk-premium` or just test whether `%5EVIX` actually works. Alternatively, use `UVXY` or just the Finnhub quote endpoint for both.

### P3: scan_candidates is extremely limited (CRITICAL — misses most data sources)
**File**: `lib/agent/tools.ts`

Old Python scanner had 6 scored sources. Current agent tool only has 2 (and movers is broken due to P1):
- ✅ Earnings calendar (Finnhub)
- ❌ Market movers (FMP — broken by double apikey)
- ❌ Analyst watchlist (never checked)
- ❌ Reddit trending (not implemented)
- ❌ StockTwits trending (not implemented)
- ❌ Finnhub trending (not implemented)

Also missing:
- Sector filtering (code has `void sectors;` — never used)
- Exclusion list filtering
- Watchlist priority scoring
- Deduplication across sources
- Market cap tier filtering

**Fix**: Rewrite scan_candidates to:
1. Accept `watchlist`, `exclusionList`, `sectors` from the agent config (passed via system prompt or tool args)
2. Call at minimum: Finnhub earnings, FMP movers, FMP gainers/losers
3. Add watchlist tickers with highest priority
4. Filter by sectors using Finnhub profile lookup
5. Remove excluded tickers
6. Score and deduplicate

### P4: get_reddit_sentiment is completely broken (CRITICAL)
**File**: `lib/agent/tools.ts`

This tool calls `pythonService('/research/run', { tickers: [ticker], ... })` which triggers the ENTIRE Python 3-step research pipeline (scanner → Data-CoT → Concept-CoT → Thesis-CoT) just to extract Reddit mentions. This:
- Takes 30-60+ seconds per ticker
- Probably times out (the agent route has 120s total for 25 steps)
- Returns the wrong data structure (full theses instead of Reddit sentiment)
- Is wildly wasteful

**Fix**: Either:
- A) Call the Python service's Reddit endpoint directly if one exists (check `python-service/routers/`)
- B) Create a lightweight `/research/reddit` endpoint in Python that just runs PRAW
- C) Remove Reddit from the agent tools and let the Python batch pipeline handle it

### P5: Technical analysis fails for many stocks
**File**: `lib/agent/tools.ts`

Finnhub candle endpoint returns `s: "no_data"` for many tickers (especially non-US, small-cap, or delisted). The error message "No price data available for technical analysis" shows as a red error box.

**Fix**:
- Try FMP as fallback for historical prices: `fmp("/historical-price-full/${ticker}?timeseries=90")`
- Return a graceful "limited data" response instead of hard error
- The agent can then narrate around missing technicals

### P6: Agent runs don't persist theses to the database
**File**: `lib/agent/tools.ts`, `app/api/research/agent/route.ts`

When the agent calls `show_thesis`, it just returns the args back. The thesis is NEVER saved to the Thesis table. This means:
- No historical record of agent research
- No thesis linkage for trades
- Performance tracking can't work
- Refreshing the page loses everything

**Fix**: In the `show_thesis` execute function, persist the thesis to the database:
```ts
execute: async (args) => {
  const thesis = await prisma.thesis.create({
    data: {
      researchRunId: runId,
      ticker: args.ticker,
      direction: args.direction,
      confidenceScore: args.confidence_score,
      // ... all fields
    }
  });
  return { ...args, thesis_id: thesis.id };
}
```

This requires passing `runId` and `userId` into the tools (currently not done — tools are stateless).

### P7: Agent runs never complete
**File**: `app/(root)/runs/[id]/page.tsx`, `lib/agent/tools.ts`

The ResearchRun stays in `status: "RUNNING"` forever. No code marks it `COMPLETE`.

**Fix**: In `summarize_run` execute function, update the run status:
```ts
execute: async (args) => {
  await prisma.researchRun.update({
    where: { id: runId },
    data: { status: "COMPLETE", completedAt: new Date() }
  });
  return args;
}
```

### P8: Legacy runs show in broken state (screenshot 2)
**File**: `app/(root)/runs/[id]/page.tsx`

The `cmmnh7ely000004jirkqhc8ia` run is a legacy Python pipeline run. It shows "Pipeline error: unsupported format string passed to NoneType.__format__" — this is a Python service bug.

This is NOT something we need to fix in the Next.js agent code. Legacy runs render via RunUnifiedChat which shows synthesized events from the Thesis table. The Python error is a data quality issue from the old pipeline.

**Fix**: No action needed for agent work. The old runs will continue to render as-is.

---

## Implementation Order

### Step 1: Fix the FMP double-apikey bug (P1)
- Quick fix in `lib/agent/tools.ts`
- Immediately unblocks market overview and movers data

### Step 2: Fix VIX quote (P2)
- Test FMP VIX URL, switch to Finnhub if needed
- Quick fix alongside P1

### Step 3: Fix technical analysis fallback (P5)
- Add FMP fallback for candle data
- Return graceful "limited data" instead of hard error

### Step 4: Fix get_reddit_sentiment (P4)
- Check if Python service has a dedicated Reddit endpoint
- If not, create one OR just mark Reddit as unavailable gracefully
- Don't block on this — agent can work without Reddit

### Step 5: Enhance scan_candidates (P3)
- Add watchlist integration
- Fix sector filtering
- Add FMP gainers/losers as additional source
- Add exclusion list filtering

### Step 6: Add thesis persistence (P6)
- Refactor tools to accept `runId`/`userId` context
- Save theses to DB in show_thesis
- Link thesis IDs to place_trade

### Step 7: Add run completion (P7)
- Mark run COMPLETE in summarize_run
- Update completedAt timestamp

---

## What NOT to change
- Don't touch the UI components (already redesigned)
- Don't change the legacy run rendering (RunUnifiedChat, RunLiveStream)
- Don't modify the Python service (focus on Next.js agent)
- Don't change the system prompt (it's already good)
- Don't change the run page routing logic (agent vs legacy works correctly)
