# CLAUDE.md — Hindsight Trading Platform

## What This App Is
AI-powered paper trading simulator. An autonomous AI agent
researches stocks, generates trade theses, places paper trades
via Alpaca, tracks performance, and learns from results.
Built for one user now, marketed later.

## Stack — DO NOT DEVIATE
- Next.js App Router, TypeScript
- ShadCN + Tailwind CSS only for UI
- Supabase (Postgres + Auth + Realtime)
- Prisma ORM (v7 with adapter-pg)
- Inngest for background jobs and crons
- Vercel (Next.js) + Railway (Python FastAPI)
- Vercel AI SDK v6 + AssistantUI (@assistant-ui/react)
- TradingView Lightweight Charts for price charts
- Recharts for performance/analytics charts

## Architecture — Two Systems (Agent + Legacy Python)

### The Agent (PRIMARY — what the "Run" button uses)
- User clicks "Run" → POST /api/research/agent-run creates ResearchRun
- Redirects to /runs/[id] → renders AgentThread component
- AgentThread uses AI SDK v6 useChat → POST /api/research/agent
- GPT-4o with 14 tools autonomously researches, generates theses,
  places trades via Alpaca
- Tools render as domain cards in UI (MarketContextCard, StockCard,
  ThesisArtifactSheet, TradeCard, etc.)
- All research persisted to DB via tool execute functions

### Legacy Python Pipeline (CRON ONLY — needs migration)
- morning-research.ts Inngest cron → POST to Python /research/run
- Python FastAPI on Railway runs FinRobot 3-step pipeline:
  Data-CoT → Concept-CoT → Thesis-CoT
- Returns theses synchronously → morning-research places Alpaca trades
- Also used by /api/research/run-stream (old SSE streaming path)
- TODO: Migrate cron to use the agent instead of Python pipeline

### Data Sources
- Finnhub: quotes, candles, earnings calendar, company metrics,
  news, stock peers (PRIMARY for all quote data)
- FMP: market movers (gainers/losers/actives), analyst targets,
  SEC filings, options chain, press releases, historical prices
  NOTE: FMP /quote/ endpoint is DEPRECATED (403 on legacy plans).
  All quote calls migrated to Finnhub.
- Alpaca: paper trade execution, order fill, position tracking
- StockTwits: trending tickers for scanner
- SEC EDGAR: filings (10-K, 10-Q, 8-K, Form 4)

## Data Model (Prisma)
- AgentConfig — analyst persona config (name, analystPrompt,
  sectors, signals, confidence threshold, direction bias,
  hold durations, position sizing, watchlist, exclusionList)
- ResearchRun — one execution; links to AgentConfig; status
  (RUNNING/COMPLETE/FAILED); parameters JSON snapshot
- RunEvent — SSE event from a run (type, title, message, payload)
- RunMessage — persisted AI SDK messages for run replay
- Thesis — stock analysis (direction, confidence, reasoning,
  bullets, risk flags, signal types, sourcesUsed, entry/target/stop)
- Trade — paper order via Alpaca (direction, status, entryPrice,
  shares, targetPrice, stopLoss, alpacaOrderId, exitStrategy)
- TradeEvent — trade lifecycle log (PLACED, PRICE_CHECK,
  NEAR_TARGET, CLOSED, EVALUATED)
- AccuracyReport — weekly per-analyst calibration (win rate,
  signal accuracy, direction stats, GPT-4o narrative)

## Pages
- / (Dashboard) — MarketPulseStrip (Finnhub WebSocket), portfolio
  summary, Today's Picks, AgentActivityLog
- /analysts — analyst card grid with enable/disable toggles
- /analysts/new — AI-driven analyst creation (AnalystBuilderChat)
- /analysts/[id] — 2-col: Overview + config | floating editor chat;
  tabs for Runs and Trades
- /runs — research run feed with status dots, analyst names,
  thesis counts, logo stacks
- /runs/[id] — run detail with 3 render modes:
  - AgentThread (live agent, agentMode=true + RUNNING)
  - RunLiveStream (legacy SSE polling, RUNNING)
  - RunUnifiedChat (completed runs, events→chat)
- /trades — paper trade list with live P&L
- /performance — accuracy reports, win rate charts
- /stocks — stock search
- /stocks/[symbol] — TradingView chart + stock detail
- /settings — app settings

## API Routes
- /api/research/agent — AI SDK v6 agent (14 tools, streamText)
- /api/research/agent-run — creates ResearchRun row, returns runId
- /api/research/run-stream — legacy Python SSE pipeline
- /api/research/events — SSE replay of RunEvent rows
- /api/research/chat — legacy Python chat proxy
- /api/research/trigger — Inngest manual trigger
- /api/chat/analyst-builder — AI analyst creation chat
- /api/chat/analyst-editor — AI analyst editing chat
- /api/chat/run-followup — post-run discussion with trade tools
- /api/agent-activity — dashboard activity stream
- /api/quotes — Finnhub quote fallback
- /api/stocks/search — Finnhub symbol search
- /api/inngest — Inngest webhook handler

## Agent Tools (14 tools in lib/agent/tools.ts)
1. get_market_overview — SPY/VIX/sector ETFs via Finnhub
2. scan_candidates — earnings + movers + StockTwits trending
3. get_stock_data — quote + company profile + metrics
4. get_technical_analysis — RSI, SMA20/50, 52W range, volume
5. get_earnings_data — earnings calendar, EPS, beat rate
6. get_unusual_options_flow — unusual options activity
7. get_reddit_sentiment — Reddit sentiment (WSB, r/stocks)
8. show_thesis — persist thesis to DB, render ThesisCard
9. place_trade — Alpaca market order, create Trade + TradeEvent
10. get_sec_filings — SEC EDGAR filings
11. get_analyst_targets — FMP analyst consensus targets
12. get_company_peers — peer comparison via Finnhub
13. get_news_deep_dive — multi-source news + press releases
14. summarize_run — mark run COMPLETE, render summary card

## Domain Components (components/domain/)
- ThesisCard / ThesisArtifactSheet — thesis display + detail sheet
- TradeCard / TradeConfirmation — trade display + pre-trade summary
- MarketContextCard — SPY/VIX/sector performance
- StockCard — quote + company profile
- ScanResultsCard — candidate ticker chip grid
- TechnicalCard — RSI/SMA/volume analysis
- EarningsCard — earnings calendar + EPS beats
- OptionsFlowCard — options flow summary
- NewsCard — news headlines + press releases
- SecFilingsCard — SEC filings list
- AnalystTargetsCard — analyst consensus targets
- PeersCard — peer company comparison
- RunSummaryCard — portfolio synthesis
- AgentConfigCard — analyst config summary

## Inngest Crons (lib/inngest/functions/)
- morning-research.ts — 8 AM ET Mon-Fri, per-analyst research
  via Python pipeline (TODO: migrate to agent)
- price-monitor.ts — hourly price check, exit evaluation
- trade-evaluator.ts — GPT-4o post-trade evaluation
- eod-evaluation.ts — end-of-day evaluation
- weekly-digest.ts — Sunday 9 AM ET digest
- accuracy-scorer.ts — weekly AccuracyReport generation

## Design Rules — READ BEFORE ANY UI WORK
- ONLY use ShadCN components from /components/ui
- NEVER create a new component if an existing one can be extended
- ALL cards: use Card from shadcn, padding p-6, same border
- ALL numbers: use tabular-nums class always
- Positive P&L: text-emerald-500 ONLY
- Negative P&L: text-red-500 ONLY
- Never hardcode hex colors, use CSS variables only
- Page titles: text-2xl font-semibold
- Section headers: text-lg font-medium
- Body text: text-sm text-muted-foreground
- Labels: text-xs font-medium uppercase tracking-wide
- Empty/loading/error states on every page and data fetch

## Key Technical Notes
- AI SDK v6: useChat sends UIMessage[] (parts array), streamText
  needs ModelMessage[] — ALWAYS convert with convertToModelMessages()
- Tool parts in v6: part.type === "tool-{toolName}", part.input
  for args, part.state === "output-available" when done
- DefaultChatTransport({ api, body }) is the transport for useChat
- AgentThread uses @assistant-ui/react with useAssistantToolUI hooks
  to render domain cards for each tool call
- Prisma Json fields (sourcesUsed, parameters) typed as unknown —
  always cast with type guard
- async params in Next.js App Router: params: Promise<{ id: string }>
- FMP /quote/ endpoint DEPRECATED — use Finnhub for all quotes
- gh auth switch --user dave-sucks before pushing

## Run Flow (Button Click → Completion)
1. Click "Run" → POST /api/research/agent-run → creates ResearchRun
2. Redirect to /runs/[id] → AgentThread renders with autoStart
3. AgentThread → useChat → POST /api/research/agent
4. Agent route loads config + historical context (trades, accuracy)
5. GPT-4o calls tools: market overview → scan → research → thesis → trade → summarize
6. Each tool renders a domain card in the chat UI
7. show_thesis persists Thesis to DB + renders ThesisArtifactSheet
8. place_trade calls Alpaca + persists Trade to DB + renders TradeCard
9. summarize_run marks run COMPLETE

## Known Issues / Tech Debt
- morning-research cron still uses Python pipeline, not agent
- FMP historical-price-full may 403 on legacy plan (affects
  technical analysis for small-cap/ADR tickers)
- Scanner returns micro-cap/ADR tickers with no Finnhub candle
  data, making technical analysis impossible
- synthesizeEventsFromTheses() doesn't generate trade_placed
  events for legacy runs
- ResearchChatFull uses custom SSE (NOT useChat/AI SDK)
- RunDetailClient.tsx is dead code (replaced by runs/[id])
- /chat page redirects to /analysts (removed)

## Key Files
### Agent System
- lib/agent/tools.ts — 14 research + trading tools
- lib/agent/system-prompt.ts — agent persona + instructions
- components/research/AgentThread.tsx — real agent UI with
  compact tool UIs for all 14 tools
- app/api/research/agent/route.ts — AI SDK streamText endpoint
- app/api/research/agent-run/route.ts — creates run row

### Run Pages
- app/(root)/runs/[id]/page.tsx — run detail (AgentThread vs
  RunLiveStream vs RunUnifiedChat based on mode/status)
- components/research/RunUnifiedChat.tsx — events→chat renderer
- components/research/RunLiveStream.tsx — SSE polling for live runs
- components/research/RunFollowupChat.tsx — post-run chat

### Analyst System
- components/analysts/AnalystBuilderChat.tsx — AI creation chat
- components/analysts/AnalystEditorChat.tsx — AI editing chat
- components/analysts/AnalystDetailClient.tsx — analyst detail 2-col
- app/api/chat/analyst-builder/route.ts — builder chat API
- app/api/chat/analyst-editor/route.ts — editor chat API

### Inngest Crons
- lib/inngest/functions/morning-research.ts — daily research
- lib/inngest/functions/price-monitor.ts — hourly price check
- lib/inngest/functions/trade-evaluator.ts — post-trade eval
- lib/inngest/functions/accuracy-scorer.ts — weekly accuracy

### Python Service (Railway)
- python-service/main.py — FastAPI app
- python-service/routers/research.py — /research endpoints
- python-service/services/finrobot.py — 3-step CoT pipeline
- python-service/services/scanner.py — market candidate scanner
- python-service/services/fmp.py — FMP client (Finnhub primary)
- python-service/services/finnhub.py — Finnhub client
- python-service/services/indicators.py — technical indicators

### Core Lib
- lib/alpaca.ts — Alpaca paper trading client
- lib/trade-exit.ts — exit strategy evaluation
- lib/market-hours.ts — isMarketOpen() with ET + holidays
- lib/prisma.ts — Prisma client (adapter-pg)

## Repo
https://github.com/dave-sucks/hindsight
