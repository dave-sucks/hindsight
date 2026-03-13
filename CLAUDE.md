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
- /runs/[id] — agent run page: AgentThread (RUNNING agent mode) or
  RunUnifiedChat (COMPLETE) or RunLiveStream (RUNNING legacy).
  Agent mode renders inline tool UIs (StockCard, PostList carousel,
  XPost, ThesisArtifactSheet, TradeCard, RunSummaryCard, etc.)
- /chat — general research chat (no analyst scope)
- /trades — full paper trade history with live P&L
- /performance — accuracy reports, win rate charts
- /stocks — TradingView chart + stock research
- /settings — AgentConfig management

## Manifest UI Components (components/manifest-ui/)
External component library installed via `npx shadcn@latest add @manifest/<name>`.
All use semantic prop structure: data, actions, appearance, control.
- **XPost** — read-only social post card (Reddit/Twitter sentiment).
  Props: data.{author, username, avatar, content, time, likes, retweets, replies}.
  Avatar renders as letter circle. Stats are read-only spans (not buttons).
- **PostCard** — blog/news card with variants: default, compact, horizontal, covered.
  Props: data.post (Post type), appearance.variant, actions.onReadMore.
- **PostList** — wraps PostCard[] with layout variants: list, grid, carousel, fullwidth.
  Props: data.posts, appearance.{variant, columns, showAuthor, showCategory}.
  **Carousel** variant is the default for article lists in agent tool UIs.
- **ProductList** — product grid with variants: list, grid, carousel, picker.
- **OrderConfirm** — order confirmation card with product info + confirm button.
  Used for trade pending state in agent UI.
- **QuickReply** — pill-shaped quick reply buttons for chat follow-ups.
- **Types** in components/manifest-ui/types.ts: Post, Product, Option, OrderItem.

## AI Elements Components (components/ai-elements/)
Custom chain-of-thought and source display components:
- **Reasoning** — collapsible reasoning block (ReasoningTrigger + ReasoningContent)
- **Sources** — collapsible source list (SourcesTrigger + SourcesContent + Source)
- **ChainOfThought** — multi-step progress display with icons and status
  (ChainOfThoughtHeader, ChainOfThoughtStep, ChainOfThoughtContent,
  ChainOfThoughtSearchResults, ChainOfThoughtSearchResult)
- **Citation** — inline/chip source citation with favicon + domain

## Agent Run Flow (AgentThread)
The agent run page (`/runs/[id]`) renders via:
1. **page.tsx** checks `agentMode` + `RUNNING` → renders `<AgentThread>`
2. **AgentThread** creates `DefaultChatTransport({ api: "/api/research/agent" })`
   + `useChatRuntime`, wraps in `AssistantRuntimeProvider`
3. **useRegisterAgentToolUIs()** registers `useAssistantToolUI` for every tool:
   - get_market_overview → MarketContextCard
   - scan_candidates → ScanResultsCard
   - get_stock_data → StockCard + PostList (carousel) for news
   - get_technical_analysis → TechnicalCard
   - get_earnings_data → EarningsCard
   - get_options_flow → OptionsFlowCard
   - get_reddit_sentiment → XPost cards
   - get_twitter_sentiment → XPost cards
   - get_sec_filings → SecFilingsCard
   - get_analyst_targets → AnalystTargetsCard
   - get_company_peers → PeersCard
   - get_news_deep_dive → PostList (carousel)
   - show_thesis → thesis pill + ThesisArtifactSheet
   - place_trade → OrderConfirm (pending) / TradeCard (filled)
   - summarize_run → RunSummaryCard
4. Every tool UI shows a **ChainOfThought** loading state (pending) and
   a **SourceChips** footer (complete) with provider-specific citations.
5. Quick replies appear after run completes via **QuickReplyComponent**.
6. For COMPLETE runs, **RunUnifiedChat** renders synthesized events.

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

## AI SDK v6 Notes — READ BEFORE TOUCHING CHAT CODE
- useChat sends UIMessage[] (parts array), streamText needs
  ModelMessage[] (content string) — ALWAYS convert with
  convertToModelMessages() in API routes
- Tool parts in v6: part.type === "tool-{toolName}" (e.g.
  "tool-suggest_config"), part.input for args, part.state ===
  "output-available" when done. Also handle "dynamic-tool" type
  with part.toolName as fallback.
- Old v3/v4 format (part.type === "tool-invocation" with
  part.toolInvocation.args) is DEAD — do not use
- toUIMessageStreamResponse() pipes streamText results back to
  useChat on the frontend
- DefaultChatTransport({ api, body }) is the transport for useChat

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

## Current Status — M1 through M10 (partial), 46 PRs merged
Full pipeline live end-to-end:
- Multi-analyst setup: each AgentConfig is an "Analyst" with its own
  sectors, signals, confidence threshold, direction bias, schedule
- Research pipeline: scanner finds candidates → Data-CoT (Finnhub,
  FMP, Reddit PRAW, unusual options flow, earnings intel, technical
  indicators) → Concept-CoT → Thesis-CoT → stored as ResearchRun +
  Theses in DB
- Paper trading: high-confidence theses auto-placed as Alpaca paper
  trades; hourly Inngest price monitor; auto-close on exit conditions;
  GPT-4o post-trade evaluation
- Accuracy/calibration: AccuracyReport generated weekly per analyst;
  win rate, calibration buckets, signal accuracy, GPT-4o narrative
- Chat: Vercel AI SDK v6 useChat on analyst builder, analyst editor,
  run follow-up; ResearchChatFull (custom SSE) on analyst detail +
  /chat page
- Run page: chat-based UI (RunChatThread) transforms SSE events into
  conversation messages with inline thesis cards, source chips,
  trade placed messages
- Analyst builder: full research experience with 10 tools — AI
  researches real stocks during brainstorming, shows ThesisCards
  inline, displays trending movers, uses $TICKER chips with live
  prices, cites sources with [N] notation, then suggests config
- Domain components: ThesisCard, TradeCard, TradeConfirmation,
  AgentConfigCard, StockQuoteCard, TrendingStocksCard all render
  inline in chat via useAssistantToolUI registrations
- Chain of thought: ChainOfThought reasoning visible on all tool
  calls across builder, editor, and run-followup chats
- Agent tools: 14 tools in lib/agent/tools.ts including extended
  data tools (SEC filings, analyst targets, company peers, news
  deep dive) — all using inputSchema for AI SDK v6 compatibility
- Floating analyst chat: analyst detail page has floating chat
  overlay for quick interactions

## Known Issues / Tech Debt
- synthesizeEventsFromTheses() does NOT generate trade_placed events
  so trades are invisible on run pages for legacy/cron runs
- ResearchChatFull uses custom SSE streaming (NOT useChat/AI SDK) —
  needs migration to AI SDK for consistency
- RunDetailClient.tsx (old 2-col thesis grid) is dead code — the run
  page is now chat-based at runs/[id]/page.tsx
- No cross-trade analysis or run-wide summary at end of runs

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
- lib/actions/accuracy.actions.ts — accuracy report actions
- lib/actions/analytics.actions.ts — analytics queries

### Core Lib
- lib/alpaca.ts — Alpaca paper trading client
- lib/trade-exit.ts — evaluateExitStrategy (4 strategies)
- lib/market-hours.ts — isMarketOpen() with ET + holidays
- lib/prisma.ts — Prisma client (adapter-pg)
- prisma.config.ts — DB connection URLs (Prisma v7)

### Key Components
- components/research/RunChatThread.tsx — run events→chat messages
  transformer (eventsToMessages) with TickerGroupMessage,
  TradePlacedMessage, RunCompleteMessage renderers
- components/research/RunFollowupChat.tsx — run follow-up chat using
  useChat + DefaultChatTransport, passes runContext to API
- components/research/RunDetailClient.tsx — OLD 2-col layout (dead
  code, replaced by runs/[id]/page.tsx chat-based view)
- components/analysts/AnalystBuilderChat.tsx — chat-driven analyst
  creation using useChat + 10 tools (research, quotes, trending,
  suggest_config). Full research experience with $TICKER chips,
  [N] citations, ThesisCards, trending movers inline
- components/analysts/AnalystEditorChat.tsx — chat-driven analyst
  editing using same pattern + diff view
- components/analysts/AnalystDetailClient.tsx — analyst detail 2-col
- components/analysts/AnalystsPageClient.tsx — analyst card grid
- components/assistant-ui/tool-uis.tsx — all tool UI renders +
  registration hooks (useRegisterBuilderToolUIs, useRegisterEditorToolUIs,
  useRegisterFollowupToolUIs). Includes StockQuoteRender,
  TrendingStocksRender, ResearchTickerRender→ThesisCard,
  PlaceTradeRender→TradeCard, CompareTickersRender, etc.
- components/assistant-ui/thread.tsx — shared Thread component with
  CitedMarkdownText + SourcesProvider (auto-renders $TICKER chips
  and [N] source citations from any tool that returns _sources)
- components/chat/TickerChip.tsx — parses $TICKER in markdown,
  renders interactive chip with live price + hover card
- components/chat/SourceChip.tsx — clickable source citations with
  favicons and provider metadata
- components/research/AgentThread.tsx — live agent run UI using
  assistant-ui runtime + useAssistantToolUI registrations for all
  15 agent tools. Renders ChainOfThought, domain cards, manifest-ui
  PostList/XPost/OrderConfirm/QuickReply inline per tool call
- components/domain/ — ThesisCard, TradeCard, TradeConfirmation,
  AgentConfigCard, StockCard, TechnicalCard, EarningsCard,
  OptionsFlowCard, ScanResultsCard, RunSummaryCard, SecFilingsCard,
  AnalystTargetsCard, PeersCard, MarketContextCard
- components/manifest-ui/ — XPost, PostCard, PostList, ProductList,
  OrderConfirm, QuickReply (external library, semantic props)
- components/ai-elements/ — Reasoning, Sources, ChainOfThought,
  Citation (custom chain-of-thought + source UI)
- components/chat/ChatComposer.tsx — shared chat input (textarea +
  context chips + recent theses)
- components/ResearchChatFull.tsx — old custom SSE chat (analyst
  detail + /chat page), uses its own streaming, NOT useChat
- components/dashboard/DashboardClient.tsx — Fey-style dashboard
- components/MarketPulseStrip.tsx — live Finnhub WebSocket ticker strip
- components/StockLogo.tsx — ticker logo from parqet with fallback

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
10. 🔄 Streaming + Agent Observability — SSE streaming infra done,
    run page chat UI done, analyst builder/editor done, follow-up
    chat done. Domain components done (ThesisCard, TradeCard,
    StockCard, TechnicalCard, EarningsCard, OptionsFlowCard,
    ScanResultsCard, RunSummaryCard, MarketContextCard,
    SecFilingsCard, AnalystTargetsCard, PeersCard).
    Source/citation system done ($TICKER chips + [N] citations
    via CitedMarkdownText + SourcesProvider). ChainOfThought on
    all tool calls. Rich builder chat with 10 tools. Extended
    agent tools (SEC, analyst targets, peers, news deep dive).
    manifest-ui wired into agent UI: XPost for social sentiment,
    PostList carousel for news, OrderConfirm for trade pending,
    QuickReply for follow-ups. ai-elements for ChainOfThought
    and Sources/Citations on every tool call.
    REMAINING: trade visibility fix for legacy/cron runs,
    cross-trade analysis, run-wide summaries, ChatComposer rewrite
11. ⬜ Product Polish — fix all known UX issues, improve mobile
    responsiveness, add cross-trade analysis, run-wide summaries
