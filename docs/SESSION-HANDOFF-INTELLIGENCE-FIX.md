# Session Handoff: Fix Intelligence Monitor System

## Context
The intelligence page (/intelligence) has monitors that run daily cron jobs to gather market data. The previous session made a mess of the monitor architecture. This document describes exactly what's broken and what needs to be fixed.

## The 3 Monitor Types

There are exactly 3 types. No more.

### 1. SEARCH
- **What it does:** Sends a query string to Perplexity Sonar API
- **What Sonar does:** Searches the web with that query, returns structured JSON
- **What comes back:** 3-8 signals per query, each with: headline, 2-3 sentence summary, extracted tickers[], themes[], sentiment (BULLISH/BEARISH/NEUTRAL/MIXED), urgency (LOW/MEDIUM/HIGH/BREAKING), sourceUrls[], sourceNames[]
- **Example query:** `"FDA drug approvals decisions and regulatory actions this week"`
- **Example response signal:** `{ headline: "FDA approves Eli Lilly's new Alzheimer's drug", summary: "The FDA granted full approval to...", tickers: ["LLY"], sentiment: "BULLISH", urgency: "HIGH", sourceUrls: ["https://statnews.com/..."], sourceNames: ["STAT News"] }`
- **Scope:** Can be firm-wide or analyst-specific
- **Includes portfolio/watchlist searches:** The portfolio & watchlist job searches each ticker with `"{TICKER} stock news developments catalysts today"`. These are searches.

### 2. DOMAIN
- **What it does:** Sends a domain-filtered query to Perplexity Sonar API
- **What Sonar does:** Searches ONLY within the specified domain (e.g. reuters.com), returns structured signals from that site only
- **What comes back:** Same signal format as SEARCH, but all results are from that one domain
- **Firecrawl addition:** For high-priority domains (priority=1), after Sonar returns signals, the job also calls Firecrawl to extract the full HTML/markdown of the source pages. These are stored as Artifact rows (title, url, full markdown content, summary). The agent can later read these via `read_artifact`.
- **Example:** Domain monitor for `statnews.com` → Sonar searches only statnews.com → returns signals about healthcare/biotech news from STAT → Firecrawl extracts the full articles
- **Scope:** Can be firm-wide or analyst-specific

### 3. API
- **What it does:** Calls a REST endpoint on FMP or Finnhub directly (no Sonar)
- **What comes back:** Raw structured data parsed into ONE aggregate signal
- **Examples:**
  - FMP `/stock_market/gainers` → returns top 10 gaining stocks with ticker, price, % change, volume → becomes 1 signal with `aggregateType: "MARKET_MOVERS_GAINERS"` and `dataPayload` containing all 10 items
  - FMP `/stock_market/losers` → same but losers
  - FMP `/stock_market/actives` → same but most active by volume
  - Finnhub `/calendar/earnings` → returns all companies reporting earnings next 7 days → becomes 1 signal with `aggregateType: "EARNINGS_CALENDAR"`
- **Scope:** Always firm-wide (built-in)

## What's Broken Right Now

### 1. Portfolio/Watchlist monitors create per-ticker rows that never get cleaned up
The previous session rewrote `portfolio-watchlist-monitor.ts` to upsert a Monitor row for each ticker (e.g. `ticker-search-aapl`, `ticker-search-tsla`). These accumulate forever — when a position is closed, the monitor row stays. This is wrong.

**Fix:** Revert to TWO permanent built-in SEARCH monitors:
- "Portfolio Searches" — `builtIn: true`, `type: "SEARCH"`, `category: "TICKER"`. The job reads current open positions at runtime and searches each ticker. The monitor row itself is permanent. It does NOT need a row per ticker.
- "Watchlist Searches" — same but reads from AnalystWatchlistItem table.

The job should: read positions/watchlist → for each ticker, send query to Sonar → create signals with `monitorId` pointing to the permanent portfolio or watchlist monitor row. On the monitor's info popover, show the current tickers being monitored (fetched dynamically, not stored on the monitor).

### 2. Monitor info popovers don't explain what happens clearly
The description text is vague. Each popover should show:
- **For SEARCH:** The exact query in a search bar visual. Below: "Sent to Perplexity Sonar → searches the web → returns structured signals (headline, summary, tickers, sentiment, urgency, sources). Signals are routed to matching analysts." Show Perplexity logo.
- **For DOMAIN:** The domain in a URL bar visual. Below: "Sent to Perplexity Sonar as a domain-filtered search → only returns results from this website. High-priority domains also get full-page extraction via Firecrawl." Show Perplexity logo + Firecrawl logo.
- **For API:** The endpoint in a code visual with GET badge. Below: "Calls this endpoint directly → returns structured market data → parsed into one aggregate signal with the top results." Show FMP or Finnhub logo.

### 3. No real provider logos
The icons for Perplexity, Firecrawl, FMP, and Finnhub should be actual logos, not generic lucide icons. Logo components exist in `components/intelligence/icons.tsx` — they need to be used prominently in both the monitor list rows and the popovers.

### 4. Findings don't clearly show their source monitor
Each finding/signal card should clearly show: which monitor produced it, what query/domain/endpoint was used, and link back to that monitor. The signal-feed.tsx already has an `inferDiscovery()` function and `DiscoveryHeader` component that renders this — but it needs to be more prominent and use real logos.

### 5. Old PORTFOLIO/WATCHLIST type monitor rows still in DB
The old built-in "Portfolio Positions" (type=PORTFOLIO) and "Watchlist Items" (type=WATCHLIST) monitor rows from before the migration are still in the DB. They need to be updated to type=SEARCH or deleted and recreated.

### 6. `sourcePackProposal` field name throughout codebase
The Zod schema field the LLM uses to propose domain monitors is still called `sourcePackProposal` in: builder route, editor route, AgentConfigData type, AnalystConfigPanel, AnalystBuilderChat, AnalystEditorChat, tool-uis diff renderer, and analyst.actions.ts. This is a cosmetic rename across ~15 files — change to `domainMonitors` or `domainProposal`.

### 7. Old Prisma models still in schema
`Source`, `SourcePack`, `SourcePackSource`, `IntelligenceQuery`, `MonitorCheckpoint` models are defined in schema.prisma but nothing reads or writes them. They should be dropped via a migration. Also `primarySourcePackId` on AgentConfig.

## Key Files

| File | What it does |
|------|-------------|
| `lib/inngest/functions/firm-market-sweep.ts` | Runs SEARCH monitors + API calls (FMP/Finnhub) |
| `lib/inngest/functions/portfolio-watchlist-monitor.ts` | **NEEDS FIX** — should use 2 permanent monitors, not per-ticker rows |
| `lib/inngest/functions/domain-monitor.ts` | Runs DOMAIN monitors via Sonar + Firecrawl |
| `lib/inngest/functions/signal-router.ts` | Routes signals to analysts |
| `lib/inngest/functions/morning-brief-generator.ts` | Generates briefs from routed signals |
| `lib/intelligence/sonar.ts` | Perplexity Sonar API client |
| `lib/intelligence/firecrawl.ts` | Firecrawl page extraction client |
| `lib/intelligence/signals.ts` | Signal creation and deduplication |
| `app/api/intelligence/monitors/route.ts` | Monitor CRUD API |
| `app/api/intelligence/trigger/route.ts` | Manual trigger for pipeline jobs |
| `app/api/intelligence/signals/route.ts` | Signal query API |
| `app/api/intelligence/briefs/route.ts` | Morning brief query API |
| `components/intelligence/config-panel.tsx` | Monitor list UI + info popovers |
| `components/intelligence/signal-feed.tsx` | Findings list + signal detail sheet |
| `components/intelligence/types.ts` | Shared types and config constants |
| `components/intelligence/icons.tsx` | Provider logo components (Perplexity, Firecrawl, FMP, Finnhub) |
| `app/(root)/intelligence/page.tsx` | Intelligence page with Findings/Monitors/Briefs tabs + pipeline trigger dropdown |

## Pipeline Schedule (all ET, weekdays only)
1. 6:30 AM — `firmMarketSweep`: SEARCH monitors + FMP gainers/losers/actives + Finnhub earnings
2. 7:00 AM — `portfolioWatchlistMonitor`: Searches each position/watchlist ticker
3. 7:15 AM — `domainMonitor`: DOMAIN monitors via Sonar + Firecrawl
4. 7:30 AM — `signalRouter`: Routes today's signals to matching analysts
5. 7:45 AM — `morningBriefGenerator`: Synthesizes routed signals into briefs per analyst

## What This Session Should NOT Touch
- Agent tools (`lib/agent/tools.ts`) — `web_search`, `read_morning_brief`, `read_signals` are all working
- Agent system prompt — already updated with web_search
- Analyst builder/editor flows — both correctly create Monitor rows
- The pipeline trigger dropdown on the intelligence page — working
- Morning brief tool UI in the agent chat — working
