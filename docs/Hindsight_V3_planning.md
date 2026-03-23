# Hindsight V3 — Persistent Intelligence Architecture

**Date:** March 22, 2026
**Status:** Planning

---

## Core Principle

Discovery = background jobs writing to a signal store.
Analyst runtime = reading pre-triaged intelligence + selective live search for verification only.

The intelligence pipeline is a **desk analyst** that prepares the briefing book before the portfolio managers (analyst agents) walk in. It doesn't make decisions. It gathers, organizes, scores, and routes. The PMs read the briefing book and decide what to act on.

---

## Daily Intelligence Timeline

```
6:30 AM  ┌─ Firm Market Intelligence Sweep ──────┐
         │  Sonar: macro, sectors, themes, events │
         └──────────────┬────────────────────────-┘
                        ▼
7:00 AM  ┌─ Portfolio & Watchlist Monitor ────────┐
         │  Sonar + Finnhub: every holding +      │
         │  watchlist name across all analysts     │
         └──────────────┬─────────────────────────┘
                        ▼
7:15 AM  ┌─ Source Pack Monitor ──────────────────┐
         │  Sonar (domain-filtered) + Firecrawl:  │
         │  firm sources + analyst-specific packs  │
         └──────────────┬─────────────────────────┘
                        ▼
7:30 AM  ┌─ Signal Router ───────────────────────-┐
         │  Score, deduplicate, tag, route signals │
         │  to analysts by mandate/sectors/watchlist│
         └──────────────┬─────────────────────────┘
                        ▼
7:45 AM  ┌─ Morning Brief Generator ─────────────-┐
         │  Per-analyst: GPT-4o reads routed       │
         │  signals + portfolio + prior brief →    │
         │  writes structured morning brief        │
         └──────────────┬─────────────────────────┘
                        ▼
8:00 AM  ┌─ Analyst Runs (existing cron) ────────-┐
         │  Agent reads morning brief + signals    │
         │  Live search ONLY for verification      │
         └────────────────────────────────────────-┘
```

---

## Provider Split

| Layer | Provider | Role | Why |
|-------|----------|------|-----|
| **Bulk search** (background jobs) | **Perplexity Sonar** | Raw search substrate | $1/M tokens, structured JSON output via `response_format`, domain/recency filters built-in, 1,200 tok/s. One call = search + extract + structure. |
| **Page extraction** (background jobs) | **Firecrawl** | Full-page markdown extraction | When Sonar finds a high-value URL (earnings transcript, deep analysis) and we need the full text. $16/mo for 3K pages. |
| **Runtime search** (analyst escalation) | **Claude web search + web fetch** | Targeted verification, last-mile research | Smarter reasoning, multi-step, reads full pages. Used selectively — 3-5 searches per run max. |
| **Financial data** | **Finnhub + FMP** (keep) | Quotes, earnings, filings, movers | Already integrated. Structured financial data that search APIs can't replace. |
| **Signal processing** | **GPT-4o-mini** | Batch signal extraction, routing, scoring | Cheap ($0.15/M input), fast. Good enough for "is this signal relevant to Analyst X?" |
| **Brief generation** | **GPT-4o** | Morning briefs, synthesis | Needs quality reasoning for per-analyst intelligence summaries. |

Sonar is the raw substrate. Claude is the reasoning layer. They don't compete — they do different jobs.

Sonar answers: "What happened in semiconductor stocks today?" → structured JSON with tickers, events, sentiment, sources.

Claude answers: "Given this analyst's thesis on AMD and these 3 conflicting signals, should the thesis be revised?" → reasoning.

---

## Three-Layer Configuration Model

The intelligence pipeline is NOT hardcoded. Three layers of configuration, each manageable.

### Layer 1: Firm-Wide Defaults (managed in settings UI)

- Fixed queries that run every day ("US market overnight", "sector rotation", etc.)
- Firm source pack (Reuters, CNBC, etc.)
- Global budgets: max searches/day, max extractions/day
- You add/remove/edit queries and sources anytime via config page

### Layer 2: Analyst-Level Config (set during creation, editable)

- Analyst source pack (Seeking Alpha for Earnings Play, TechCrunch for Trend Chaser)
- Analyst-specific standing queries ("semiconductor supply chain developments", "biotech FDA pipeline")
- Per-analyst search budget (e.g. 10 queries/day max)
- Stored on IntelligenceConfig model linked to AgentConfig

### Layer 3: Dynamic Queries (from agents themselves)

- **Post-run briefing agent** proposes temporary monitors: "Based on today's session, add a 7-day watch for 'Tesla China manufacturing partnership'" → MonitorCheckpoint with expiration date
- **Analyst builder/editor** proposes source pack changes: "This analyst focuses on EV stocks — recommend adding CleanTechnica, Electrek, InsideEVs" → SourcePack entries
- **Analyst runtime** can flag topics for follow-up: "Need more data on this FDA decision next week" → temporary query

Flow:
```
You configure base queries + sources in UI
  → Analyst builder adds analyst-specific sources at creation
    → Each run, briefing agent can add/expire temporary watches
      → Morning jobs execute ALL of the above
        → Config UI shows everything: active queries, temp watches, budgets
```

---

## Pre-Run Intelligence Jobs

### Job 1: Firm Market Intelligence Sweep

**Schedule:** 6:30 AM ET Mon-Fri
**Provider:** Perplexity Sonar
**Input:** Firm-level IntelligenceQuery rows (configurable via UI)

Default queries (~15/day, editable):
- "US stock market overnight developments today"
- "Federal Reserve monetary policy news today"
- "S&P 500 sector rotation trends this week"
- Per-sector queries for active sectors
- "Upcoming earnings reports this week major companies"
- "FDA approvals decisions this week"
- "Unusual options activity large block trades today"
- "Geopolitical events affecting markets today"

Each query uses Sonar `response_format` with JSON schema:
```typescript
{
  signals: [{
    headline: string
    summary: string       // 2-3 sentences
    tickers: string[]     // mentioned tickers
    themes: string[]      // e.g. "AI_CAPEX", "FED_RATE_CUT"
    sectors: string[]
    sentiment: "BULLISH" | "BEARISH" | "NEUTRAL"
    urgency: "LOW" | "MEDIUM" | "HIGH"
    sourceUrls: string[]
    sourceNames: string[]
  }]
}
```

**Writes:** SignalBatch + individual Signal rows + market context summary artifact.

### Job 2: Portfolio & Watchlist Monitor

**Schedule:** 7:00 AM ET (after market sweep)
**Provider:** Sonar + Finnhub
**Scope:** Every open position + every watchlist item across ALL analysts (deduplicated)

For each ticker:
- Sonar: `"{ticker} stock news developments today"` with `search_recency_filter: "day"`
- Finnhub: quote, any earnings in next 5 days, any filings in last 24h

**Writes:** Signals tagged to specific positions/watchlist items. Flags: near-target, near-stop, earnings-imminent, filing-detected, news-catalyst.

### Job 3: Source Pack Monitor

**Schedule:** 7:15 AM ET
**Provider:** Sonar (domain-filtered) + Firecrawl (for high-value pages)

For each source in each active pack:
- Sonar: search scoped to `search_domain_filter: ["seekingalpha.com"]` with recency filter
- Compare against MonitorCheckpoint (last content hash / last checked)
- If new content found → Firecrawl extract full page → create Artifact + Signals

**Writes:** Artifacts (raw extracted content) + Signals (structured evidence from new content).

### Job 4: Signal Router

**Schedule:** 7:30 AM ET (after all collection jobs complete)
**Provider:** GPT-4o-mini (cheap batch processing)

- Load all signals from today's batches
- Deduplicate by content hash
- For each analyst: score relevance based on:
  - Ticker overlap with holdings/watchlist
  - Sector overlap with mandate
  - Theme overlap with signal types
  - Source quality x freshness x novelty
- Write AnalystSignalRoute entries with relevance scores and routing reasons

### Job 5: Morning Brief Generator

**Schedule:** 7:45 AM ET
**Provider:** GPT-4o

Per analyst input: routed signals (top 20 by relevance), portfolio state, watchlist, prior brief, accuracy stats.

Output structured brief:
```typescript
{
  marketContext: string         // 3-4 sentences on regime/themes
  portfolioAlerts: [{
    ticker: string
    alert: string              // "near target", "earnings tomorrow", "negative news"
    urgency: "HIGH" | "MEDIUM" | "LOW"
    signalIds: string[]
  }]
  watchlistUpdates: [{
    ticker: string
    update: string
    recommendation: "ESCALATE" | "MONITOR" | "REMOVE"
    signalIds: string[]
  }]
  newOpportunities: [{
    headline: string
    tickers: string[]
    thesis_seed: string        // 1-2 sentence thesis starter
    signalIds: string[]
  }]
  attentionPriority: string[]  // ordered list of tickers to focus on today
  riskFlags: string[]
}
```

### Job 6: Email/Newsletter Ingestion (V2)

**Schedule:** Hourly or webhook-triggered
**Provider:** Gmail API + GPT-4o-mini for extraction
Later phase. Parse incoming newsletters, extract signals, route to analysts.

---

## Runtime Analyst Tools (Revised)

### Revised Runtime Flow

**Phase 0: PORTFOLIO CHECK-IN** (unchanged)

**Phase 1: READ INTELLIGENCE** (replaces current ORIENT + DISCOVER)
- `read_morning_brief` → today's MorningBrief
- `read_signals` → AnalystSignalRoute queue (filtered, sorted)
- Agent acknowledges market context, portfolio alerts, new opportunities
- Agent states focus for today

**Phase 2: REVIEW HOLDINGS** (mostly unchanged, but informed by portfolio alerts from brief)

**Phase 3: REVIEW WATCHLIST** (mostly unchanged, informed by watchlist updates from brief)

**Phase 4: INVESTIGATE** (replaces DISCOVER)
- Agent picks from `newOpportunities` in the brief
- Uses existing research tools for deep dives
- `web_search` — Claude web search for targeted follow-up ONLY
- `web_fetch` — Claude web fetch to read a specific URL
- These are escalation tools, not discovery tools

**Phase 5-7: SYNTHESIZE → EXECUTE → WRAP UP** (mostly unchanged)

### V3 Tool Inventory

**Intelligence consumption (new):**
1. `read_morning_brief` — today's pre-generated brief
2. `read_signals` — routed signals with filters (by ticker, theme, urgency)
3. `read_artifact` — full extracted content from a specific source

**Live search (new, selective use):**
4. `web_search` — Claude web search for verification/escalation
5. `web_fetch` — Claude web fetch to read a specific page

**Financial data (keep):**
6. `get_market_context` — SPY/VIX/sectors via Finnhub
7. `get_stock_data` — quote + profile + metrics
8. `get_technical_analysis` — RSI/SMA/volume
9. `get_earnings_data` — detailed EPS/beat data (calendar moves to background)
10. `get_sec_filings` — SEC EDGAR
11. `get_analyst_targets` — FMP consensus
12. `get_company_peers` — Finnhub peers

**Action tools (keep):**
13. `record_thesis` — persist thesis
14. `place_trade` — Alpaca order
15. `close_position` — exit
16. `manage_watchlist` — add/remove/update
17. `complete_run` — wrap up

---

## Integration with Existing Architecture

Several current runtime tools migrate to background intelligence:

| Currently runtime (per-run) | Becomes background (once/day) | Runtime tool becomes |
|---|---|---|
| `scan_candidates` (StockTwits + earnings + movers) | Morning sweep captures all of this | **KILLED** — replaced by morning brief + signals |
| `get_news_deep_dive` (multi-source news per ticker) | Source pack monitor + portfolio monitor surface news | `read_signals` for pre-gathered news. `web_search` only for new names |
| `get_earnings_data` (calendar lookup) | Portfolio monitor checks earnings dates daily | Keeps detailed EPS/beat data, but "is earnings coming?" answered in brief |
| `get_reddit_sentiment` | Add subreddits to source packs if Reddit matters | **KILLED** — sentiment becomes a signal type |
| Market context themes | Market sweep captures themes/regime | `get_market_context` stays for live prices, themes come from brief |

News-to-stock linking: every Signal has `tickers[]`. When the agent looks at AMD, `read_signals({ tickers: ["AMD"] })` returns every piece of intelligence gathered that morning — news, filings, earnings, social — all pre-gathered, all linked.

Agent runtime gets faster and cheaper: instead of 8-12 tool calls to orient and discover, it's 2 calls (`read_morning_brief` + `read_signals`). More of the 30-step budget goes to actual research and decisions.

---

## Data Models (New Prisma Entities)

```prisma
model Source {
  id              String   @id @default(cuid())
  name            String   // "Seeking Alpha", "STAT News"
  type            String   // DOMAIN, RSS, NEWSLETTER, TWITTER, API
  url             String?  // base URL or feed URL
  domain          String?  // "seekingalpha.com"
  category        String   // MARKET, SECTOR, COMPANY, THEMATIC, SOCIAL, EVENT
  qualityScore    Int      @default(3) // 1-5
  checkFrequency  String   @default("DAILY") // HOURLY, DAILY, WEEKLY
  enabled         Boolean  @default(true)
  lastCheckedAt   DateTime?
  packs           SourcePackSource[]
  artifacts       Artifact[]
  checkpoints     MonitorCheckpoint[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model SourcePack {
  id          String   @id @default(cuid())
  name        String   // "Firm Market Pack", "Earnings Play Tech Pack"
  scope       String   // FIRM, ANALYST
  analystId   String?
  analyst     AgentConfig? @relation(fields: [analystId], references: [id])
  sources     SourcePackSource[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model SourcePackSource {
  id           String     @id @default(cuid())
  packId       String
  sourceId     String
  pack         SourcePack @relation(fields: [packId], references: [id])
  source       Source     @relation(fields: [sourceId], references: [id])
  priority     Int        @default(2) // 1=critical, 2=standard, 3=supplementary
  @@unique([packId, sourceId])
}

model IntelligenceQuery {
  id          String   @id @default(cuid())
  scope       String   // FIRM, ANALYST
  analystId   String?
  analyst     AgentConfig? @relation(fields: [analystId], references: [id])
  query       String   // the actual search query text
  category    String   // MARKET, SECTOR, TICKER, THEMATIC, EVENT
  enabled     Boolean  @default(true)
  expiresAt   DateTime? // null = permanent, set for temporary watches
  createdBy   String   // "USER", "BRIEFING_AGENT", "ANALYST_BUILDER"
  sourceRunId String?  // which run/briefing created this (for dynamic queries)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([scope, enabled])
  @@index([analystId])
}

model Artifact {
  id              String   @id @default(cuid())
  sourceId        String?
  source          Source?  @relation(fields: [sourceId], references: [id])
  url             String
  title           String
  contentMarkdown String?
  contentSummary  String?
  contentHash     String   // SHA256 for dedup
  publishedAt     DateTime?
  fetchedAt       DateTime @default(now())
  signals         Signal[]
  @@index([contentHash])
  @@index([url])
}

model Signal {
  id             String   @id @default(cuid())
  batchId        String
  batch          SignalBatch @relation(fields: [batchId], references: [id])
  artifactId     String?
  artifact       Artifact? @relation(fields: [artifactId], references: [id])
  type           String   // NEWS, EARNINGS, FILING, SOCIAL, PRICE_ACTION,
                          // ANALYST_NOTE, OPTIONS, MACRO, SECTOR
  headline       String
  summary        String
  evidence       String?
  tickers        String[]
  themes         String[] // "AI_CAPEX", "FED_RATE_CUT", "EARNINGS_BEAT"
  sectors        String[]
  sentiment      String   // BULLISH, BEARISH, NEUTRAL, MIXED
  noveltyScore   Int      @default(50) // 0-100
  urgency        String   @default("MEDIUM") // LOW, MEDIUM, HIGH, BREAKING
  sourceQuality  Int      @default(3) // 1-5
  freshness      String   // BREAKING, TODAY, THIS_WEEK, OLDER
  sourceUrls     String[]
  sourceNames    String[]
  expiresAt      DateTime?
  routes         AnalystSignalRoute[]
  createdAt      DateTime @default(now())
  @@index([tickers])
  @@index([themes])
  @@index([createdAt])
}

model SignalBatch {
  id          String   @id @default(cuid())
  jobType     String   // MARKET_SWEEP, PORTFOLIO_MONITOR, SOURCE_PACK, MANUAL
  status      String   @default("RUNNING") // RUNNING, COMPLETE, FAILED
  signalCount Int      @default(0)
  signals     Signal[]
  startedAt   DateTime @default(now())
  completedAt DateTime?
}

model AnalystSignalRoute {
  id             String      @id @default(cuid())
  analystId      String
  analyst        AgentConfig @relation(fields: [analystId], references: [id])
  signalId       String
  signal         Signal      @relation(fields: [signalId], references: [id])
  relevanceScore Int         // 0-100
  routeReason    String      // "ticker_match:AMD", "sector_match:TECH"
  status         String      @default("PENDING") // PENDING, READ, ACTED_ON, DISMISSED
  routedAt       DateTime    @default(now())
  @@index([analystId, status])
  @@index([analystId, routedAt])
}

model MonitorCheckpoint {
  id              String   @id @default(cuid())
  sourceId        String?
  queryHash       String?
  lastCheckedAt   DateTime
  lastContentHash String?
  resultCount     Int      @default(0)
  nextCheckAt     DateTime?
  @@index([sourceId])
  @@index([queryHash])
}

model MorningBrief {
  id                String      @id @default(cuid())
  analystId         String
  analyst           AgentConfig @relation(fields: [analystId], references: [id])
  date              DateTime    @db.Date
  marketContext     String
  portfolioAlerts   Json        // [{ticker, alert, urgency, signalIds}]
  watchlistUpdates  Json        // [{ticker, update, recommendation, signalIds}]
  newOpportunities  Json        // [{headline, tickers, thesis_seed, signalIds}]
  attentionPriority String[]
  riskFlags         String[]
  signalCount       Int         @default(0)
  generatedAt       DateTime    @default(now())
  @@unique([analystId, date])
}
```

---

## Source Pack Recommendations

### Firm-Wide Starter Pack (~12 sources)

**Broad market/news:**
- Reuters, Bloomberg (via Sonar domain filter), CNBC, MarketWatch, WSJ, Yahoo Finance

**Macro/economic:**
- Federal Reserve (federalreserve.gov), Treasury.gov, BLS releases

**Event-driven:**
- Finnhub earnings calendar (already integrated)
- FDA.gov approvals/decisions
- SEC.gov major filings

### Trend Chaser Pack (~6 sources)
- TechCrunch, The Verge (tech catalysts)
- Investor's Business Daily (breakouts, momentum)
- Benzinga (catalyst news)
- StockTwits trending (migrate from current tool to source pack)

### Earnings Play Pack (~6 sources)
- Seeking Alpha (earnings analysis)
- Earnings Whispers (pre-earnings consensus)
- STAT News (healthcare/biotech)
- BioPharma Dive (pharma)
- American Banker (financials)

### Future: Builder-Generated Packs
Analyst builder chat proposes initial source pack based on mandate during creation. 3-5 Sonar queries to research relevant sources → save as SourcePack.

---

## Cost Model

### V1 Monthly (3 analysts, 22 trading days)

| Item | Volume | Unit Cost | Monthly |
|------|--------|-----------|---------|
| Sonar — market sweep | 15 queries x 22 days = 330 | ~$0.005/query | $1.65 |
| Sonar — portfolio/watchlist | 25 tickers x 22 days = 550 | ~$0.005/query | $2.75 |
| Sonar — source packs | 25 sources x 22 days = 550 | ~$0.008/query | $4.40 |
| GPT-4o-mini — signal routing | 22 batch calls | ~$0.02/call | $0.44 |
| GPT-4o — morning briefs | 66 calls | ~$0.08/call | $5.28 |
| Firecrawl — extraction | ~150 pages/month | Free tier (500) | $0 |
| Claude web search — runtime | 264 searches | $0.01/search | $2.64 |
| **New V1 total** | | | **~$17/month** |

### V2 Adds

| Item | Estimate |
|------|----------|
| Gmail API | Free |
| GPT-4o-mini email parsing | +$2-5/mo |
| More source packs (5+ analysts) | +$10-15/mo |
| Firecrawl paid tier | +$16/mo |
| **V2 new spend** | **~$45-55/month** |

---

## What To Kill / Keep

| Current Tool | Verdict | Reason |
|-------------|---------|--------|
| `scan_candidates` | **KILL** | Fake discovery. Replaced by morning brief + routed signals. |
| `get_news_deep_dive` | **KILL** | Replaced by source pack monitoring + `web_search` for escalation. |
| `get_reddit_sentiment` | **KILL** | Weak signal. Add subreddits to source packs if needed. |
| `get_unusual_options_flow` | **EVALUATE** | Keep if data source is reliable, else move to background signal. |
| `get_market_context` | **KEEP** | Fast Finnhub call for live SPY/VIX/sectors. |
| `get_stock_data` | **KEEP** | Core research — live quote + profile + metrics. |
| `get_technical_analysis` | **KEEP** | Valuable for thesis validation. |
| `get_earnings_data` | **KEEP** | Calendar moves to background, detailed EPS stays runtime. |
| `get_sec_filings` | **KEEP** | Structured data for deep research. |
| `get_analyst_targets` | **KEEP** | FMP consensus. |
| `get_company_peers` | **KEEP** | Peer comparison. |
| `record_thesis` | **KEEP** | Core action. |
| `place_trade` / `close_position` | **KEEP** | Core execution. |
| `manage_watchlist` | **KEEP** | Core portfolio management. |
| `complete_run` | **KEEP** | Run lifecycle. |
| Python FastAPI service | **KILL** | Nothing needs it after V3. |

---

## Epic Order

### Epic 1: Evidence Layer Foundation (Week 1)
- Prisma models: Source, SourcePack, Artifact, Signal, SignalBatch, AnalystSignalRoute, MonitorCheckpoint, MorningBrief, IntelligenceQuery
- TypeScript types for signal schemas, Sonar response formats
- Seed firm-wide source pack + analyst source packs + default queries
- Basic signal CRUD utilities

### Epic 2: Intelligence Jobs (Weeks 2-3)
- Sonar API client (OpenAI-compatible SDK)
- Firecrawl client
- Inngest: firm market intelligence sweep
- Inngest: portfolio & watchlist monitor
- Inngest: source pack monitor
- Inngest: signal router
- Inngest: morning brief generator
- MonitorCheckpoint management (dedup, freshness)
- Job orchestration (sequential with fan-out)

### Epic 3: Runtime Integration (Weeks 3-4)
- New tools: `read_morning_brief`, `read_signals`, `read_artifact`
- New tools: `web_search`, `web_fetch` (Claude API)
- Rewrite system prompt (Phase 1 = read intelligence, Phase 4 = investigate)
- Agent consumes MorningBrief + AnalystSignalRoute in context

### Epic 4: Intelligence Config UI (Week 4)
- Settings page for firm-wide queries + sources
- Per-analyst query/source management
- Active temporary watches (from briefing agent)
- Budget meters (searches used / limit)
- Job status dashboard (last run, signal counts)

### Epic 5: Analyst Policy System (Week 5)
- SourcePack ↔ AgentConfig relation
- Signal routing rules driven by config
- Discovery budget per analyst
- Tool permissions per analyst
- Attention policy (holdings vs watchlist vs new)

### Epic 6: Tool Rationalization (Week 5-6)
- Kill scan_candidates, get_news_deep_dive, get_reddit_sentiment
- Evaluate get_unusual_options_flow
- Kill Python service
- Update tool UIs for new tools

### Epic 7: Dynamic Intelligence (Week 6-7)
- Briefing agent writes temporary IntelligenceQuery rows
- Analyst builder proposes source packs at creation
- Analyst editor can modify source packs
- Expiration/cleanup of temporary watches

### Epic 8: Email/Newsletter Ingestion (Week 7+)
- Gmail API setup
- Email parsing → Artifact creation
- Signal extraction from newsletters
- Routing to analysts

---

## MVP vs End-State

### MVP (Epics 1-3, ~4 weeks)
- Signal schema populated by background jobs
- 5 intelligence jobs run every morning
- Agent reads brief + signals instead of scanning from scratch
- `web_search` + `web_fetch` for runtime escalation
- **This is the "feels completely different" milestone.** The agent wakes up informed.

### V1 Complete (Epics 1-6, ~6 weeks)
- Config UI for managing queries/sources/budgets
- Analyst policy system differentiates behavior
- Old tools killed, clean inventory
- Python service decommissioned
- ~$17/month new spend

### V2 (Epics 7-8, weeks 7+)
- Dynamic intelligence from briefing agent
- Email ingestion
- Builder-generated source packs
- Source quality scoring over time

---

## First PRs

### PR 1: Evidence Layer Schema
- New Prisma models (all above)
- Migration
- TypeScript types for signal formats, Sonar response schemas
- Seed data: firm source pack, analyst source packs, default queries
- ~400-600 lines. Pure schema. Lands in 1 day.

### PR 2: Sonar + Firecrawl Clients
- `lib/intelligence/sonar.ts` — Sonar client (OpenAI SDK with Perplexity base URL)
- `lib/intelligence/firecrawl.ts` — Firecrawl extraction client
- `lib/intelligence/signals.ts` — signal creation/dedup utilities
- Environment variables for API keys
- ~300-400 lines. Infrastructure. Lands in 1 day.

### PR 3: Morning Intelligence Pipeline
- 5 new Inngest functions
- Job orchestration
- MonitorCheckpoint management
- Wired into Inngest handler
- ~800-1200 lines. The core. Lands in 3-5 days.

### PR 4: Runtime Integration
- New tools: `read_morning_brief`, `read_signals`, `web_search`, `web_fetch`
- Rewritten system prompt
- Agent thread updated for new tool UIs
- ~600-800 lines. Lands in 2-3 days.
