# CLAUDE.md — Hindsight Trading Platform

## What This App Is
AI-powered paper trading simulator that graduates to real
trading. An AI agent autonomously researches stocks, generates
trade theses, places paper trades, tracks performance, and
learns what works. Built for one user now, marketed later.

## Stack — DO NOT DEVIATE
- Next.js App Router, TypeScript
- ShadCN + Tailwind CSS only for UI
- Supabase (Postgres + Auth + Realtime)
- Prisma ORM
- Inngest for background jobs and crons
- Vercel (Next.js) + Railway (Python/FinRobot)
- TradingView Lightweight Charts for price charts
- Recharts for performance/analytics charts

## Architecture
- Next.js frontend calls Python FastAPI microservice on Railway
- FastAPI runs FinRobot 3-step pipeline: Data-CoT → Concept-CoT → Thesis-CoT
- Data-CoT: parallel Finnhub + FMP + Reddit + options flow + earnings intel fetch
- Concept-CoT: GPT-4o picks direction (LONG/SHORT/PASS) + confidence score
- Thesis-CoT: GPT-4o writes full thesis with bullets, risks, entry/target/stop
- Theses stored in Supabase Postgres via Prisma
- Supabase Realtime pushes live price updates to UI
- Inngest crons: morning research (8 AM ET), hourly price monitor,
  EOD evaluation, weekly digest, accuracy scoring

## Data Model (Prisma)
- AgentConfig — analyst config (sectors, signals, confidence threshold,
  direction bias, hold durations, position sizing, schedule)
- ResearchRun — one execution of the pipeline; links to AgentConfig;
  contains parameters snapshot at run time
- Thesis — one stock analysis from a run (direction, confidence,
  reasoning, bullets, risk flags, signal types, sourcesUsed JSON,
  entry/target/stop prices, modelUsed)
- Trade — paper order placed for a high-confidence thesis; tracked
  via Alpaca; has TradeEvents log (PLACED, PRICE_CHECK, NEAR_TARGET,
  CLOSED, EVALUATED)
- AccuracyReport — weekly calibration report (win rate, signal accuracy,
  direction stats, GPT-4o narrative)

## Pages
- / (Dashboard) — Fey-inspired layout: MarketPulseStrip (live
  Finnhub WebSocket), portfolio summary, Today's Picks, AgentActivityLog
- /analysts — analyst cards with track records + on/off toggle
- /analysts/[id] — Perplexity 2-col layout: Overview (stats + strategy
  config) | Chat (ResearchChatFull); tabs for Runs and Trades
- /research — run feed with analyst pills, collapsible RunCards
- /research/runs/[id] — run detail: 2-col layout left=thesis grid
  (with collapsible sources per thesis + agent config param badges),
  right=ResearchChatFull scoped to that analyst
- /chat — general research chat (no analyst scope)
- /trades — full paper trade history with live P&L
- /performance — accuracy reports, win rate charts
- /stocks — TradingView chart + stock research
- /settings — AgentConfig management

## Design Rules — READ BEFORE ANY UI WORK
- ONLY use ShadCN components from /components/ui
- NEVER create a new component if an existing one can be extended
- ALL cards: use Card from shadcn, padding p-6, same border everywhere
- ALL numbers: use tabular-nums class always
- Positive P&L: text-emerald-500 ONLY
- Negative P&L: text-red-500 ONLY
- Never hardcode hex colors, use CSS variables only
- Page titles: text-2xl font-semibold
- Section headers: text-lg font-medium
- Body text: text-sm text-muted-foreground
- Labels: text-xs font-medium uppercase tracking-wide
- Empty states: every page needs one
- Loading states: every data fetch needs one
- Error states: every API call needs one
- Perplexity 2-col layout: flex h-[calc(100dvh-5.25rem)] overflow-hidden,
  left flex-1 min-w-0 overflow-y-auto, right hidden lg:flex w-[420px] border-l

## Before ANY UI ticket
- Check /components/ui before building anything new
- If you've written same JSX pattern twice, extract a component
- Every screen should look identical in spacing to adjacent screens
- Same border radius, same shadow, same padding everywhere

## Key Technical Notes
- Base UI Button uses render prop: render={<Link href="..." />}
  NOT Radix asChild
- Prisma Json fields (sourcesUsed, parameters, fullResearch) are
  typed as unknown in TS — always cast with a type guard helper
- GitHub squash-merge conflict trap: never cherry-pick onto a branch
  that diverged from a squash-merged ancestor — create fresh branch
  from main instead
- gh auth switch --user dave-sucks required before pushing
  (active account may default to db-lev)
- async params in Next.js App Router: params: Promise<{ id: string }>
  must be awaited

## API Keys Available (in .env.local)
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- DATABASE_URL + DIRECT_URL
- ALPACA_API_KEY + ALPACA_API_SECRET
- ALPACA_BASE_URL=https://paper-api.alpaca.markets
- FINNHUB_API_KEY
- FMP_API_KEY
- OPENAI_API_KEY
- INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY
- PYTHON_SERVICE_URL (Railway — Python FastAPI microservice)
- PYTHON_SERVICE_SECRET (shared secret for X-Service-Secret header)

## Repo
https://github.com/dave-sucks/hindsight

## Current Status — M1 through M10 complete
Full pipeline live end-to-end:
- Multi-analyst setup: each AgentConfig is an "Analyst" with its own
  sectors, signals, confidence threshold, direction bias, schedule,
  strategyInstructions (inline-editable prompt-first in analyst detail)
- Research pipeline: scanner finds candidates → Data-CoT (Finnhub,
  FMP, Reddit PRAW, unusual options flow, earnings intel, technical
  indicators) → Concept-CoT → Thesis-CoT → stored as ResearchRun +
  Theses in DB; streaming SSE endpoint emits RunEvents per step
- Paper trading: high-confidence theses auto-placed as Alpaca paper
  trades; hourly Inngest price monitor; auto-close on exit conditions;
  GPT-4o post-trade evaluation; trade detail links back to originating
  research run
- Accuracy/calibration: AccuracyReport generated weekly per analyst;
  win rate, calibration buckets, signal accuracy, GPT-4o narrative
- Run detail page: chat conversation layout — SSE events stream as bot
  messages, user/assistant chat merges into same feed (RunConversation
  + RunComposer); context rail shows candidates + theses + decisions
- Run-scoped chat: /api/runs/[id]/chat with slash commands
  (/cancel /size /stop /target /limit /market); streamed tokens
- RunEvent + RunMessage persisted to DB; pre-streaming runs get
  synthesized events so timeline always renders something

## Key Files
### Backend / Python
- python-service/routers/research.py — /research/run (batch) endpoint
- python-service/services/finrobot.py — 3-step CoT pipeline + system prompts
- python-service/services/scanner.py — real market candidate scanner
- python-service/services/indicators.py — RSI, MACD, Bollinger, SMA, 52W
- python-service/services/reddit.py — PRAW Reddit sentiment (WSB, r/investing)
- python-service/services/options_flow.py — unusual options flow
- python-service/services/earnings_intel.py — earnings calendar + intel
- python-service/services/stocktwits.py — StockTwits trending discovery
- python-service/services/finnhub.py — Finnhub data client

### Inngest Crons
- lib/inngest/functions/morning-research.ts — 8 AM ET daily agent run
- lib/inngest/functions/price-monitor.ts — hourly price check + exit eval
- lib/inngest/functions/trade-evaluator.ts — post-close GPT-4o eval
- lib/inngest/functions/weekly-digest.ts — Sunday 9 AM ET digest email
- lib/inngest/functions/accuracy-scorer.ts — weekly AccuracyReport gen
- lib/inngest/functions/eod-evaluation.ts — end-of-day evaluation

### Server Actions
- lib/actions/trade.actions.ts — createTrade
- lib/actions/closeTrade.actions.ts — closeTrade (P&L, WIN/LOSS)
- lib/actions/portfolio.actions.ts — getDashboardData
- lib/actions/analyst.actions.ts — analyst CRUD
- lib/actions/research.actions.ts — research run actions
- lib/actions/run-events.actions.ts — getOrSynthesizeRunEvents, getRunMessages
- lib/actions/run-persistence.ts — shared persistThesesAndTrades helper
- lib/actions/accuracy.actions.ts — accuracy report actions
- lib/actions/analytics.actions.ts — analytics queries

### Core Lib
- lib/alpaca.ts — Alpaca paper trading client
- lib/trade-exit.ts — evaluateExitStrategy (4 strategies)
- lib/market-hours.ts — isMarketOpen() with ET + holidays
- lib/prisma.ts — Prisma client (adapter-pg)
- lib/run-event-types.ts — RunEventType const map
- prisma.config.ts — DB connection URLs (Prisma v7)

### Key Components
- components/research/RunDetailClient.tsx — 3-region run detail layout
  (conversation center, context rail right, composer bottom)
- components/research/RunConversation.tsx — unified events+chat feed
  (events as bot messages, user/assistant chat bubbles, auto-scroll)
- components/research/RunComposer.tsx — full-width chat composer
  (streaming tokens, slash command hints, disabled during live runs)
- components/research/RunSidebar.tsx — context rail (candidates,
  theses, trade decisions extracted from run events)
- components/research/RunTimeline.tsx — legacy timeline (kept)
- components/research/RunChatBar.tsx — legacy chat bar (kept)
- components/research/ResearchPage.tsx — run feed + NewRunSheet
- components/analysts/AnalystDetailClient.tsx — prompt-first layout;
  StrategyInstructionsEditor inline-editable at top of Overview tab
- components/analysts/AnalystsPageClient.tsx — analyst card grid
- components/ResearchChatFull.tsx — full-bleed chat (analyst or general)
- components/dashboard/DashboardClient.tsx — Fey-style dashboard
- components/MarketPulseStrip.tsx — live Finnhub WebSocket ticker strip

### API Routes (M10)
- app/api/research/run/stream/route.ts — relay-and-persist SSE proxy
  to Python streaming endpoint; persists RunEvents to DB
- app/api/research/runs/[id]/events/route.ts — polling SSE for live
  run page; reconnects on disconnect
- app/api/runs/[id]/chat/route.ts — run-scoped chat with slash commands

## Prisma Notes (v7)
- Prisma 7 uses prisma.config.ts (not schema.prisma) for DB URLs
- Client uses @prisma/adapter-pg — see lib/prisma.ts
- Run `npx prisma generate` after schema changes
- Run `npx prisma migrate dev` to apply migrations

## Milestones
1. ✅ Foundation — Supabase, Prisma, Auth, Vercel deploy
2. ✅ UI Shell — Perplexity-inspired redesign, all pages scaffolded
3. ✅ FinRobot microservice on Railway, FastAPI wrapper
4. ✅ Paper trading lifecycle — create, track, evaluate trades
5. ✅ Live data — Supabase Realtime, Inngest crons, Alpaca integration
6. ✅ Polish — real data wiring, performance dashboard
7. ✅ Research Intelligence Overhaul — real market scanner, technical
   indicators (RSI/MACD/Bollinger/SMA/52W), analyst consensus data,
   TradingAgents multi-agent pipeline, R:R ratio, chat memory,
   Fey-style dashboard redesign, research feed with analyst pills
8. ✅ Analyst Platform — multi-analyst model (AgentConfig), 5 seeded
   personas, /analysts page + cards, /analysts/[id] detail + config,
   per-analyst performance tracking, analyst creation wizard
9. ✅ Advanced Data Sources + Agent Tuning — Reddit PRAW sentiment,
   unusual options flow, earnings intelligence, agent confidence
   calibration from WIN/LOSS history, weekly accuracy benchmarking
   NOTE: DAV-74 (options flow source) + DAV-75 (earnings whispers)
   still in backlog — data exists but not surfaced in UI
10. ✅ Streaming + Agent Observability — SSE streaming pipeline
    (Python asyncio.Queue → Next.js relay-and-persist → client);
    RunEvent + RunMessage schema; run detail as chat conversation
    (RunConversation + RunComposer); run-scoped chat with slash
    commands; analyst prompt-first layout with inline instruction
    editor; trade detail links back to originating run
11. ⬜ Next milestone TBD
