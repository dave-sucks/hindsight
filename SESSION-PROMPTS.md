# Hindsight — Parallel Session Prompts

Run Sessions 1 + 3 in parallel, then Session 2 after Session 1 merges.

```
┌─────────────┐     ┌─────────────┐
│ Session 1   │     │ Session 3   │
│ Tool UI     │     │ Agent       │
│ Unification │     │ Intelligence│
└──────┬──────┘     └─────────────┘
       │ merge
       ▼
┌─────────────┐
│ Session 2   │
│ Followup    │
│ Chat + Perf │
└─────────────┘
```

---

## Shared Context Block (paste at the top of ALL sessions)

```
## CONTEXT: Hindsight Trading Platform — Current State

### What This App Is
AI-powered paper trading simulator. An autonomous AI agent researches stocks, generates trade theses, places paper trades via Alpaca, and learns from results. Next.js App Router, TypeScript, ShadCN + Tailwind, Supabase/Prisma, AI SDK v6 + @assistant-ui/react.

### The Daily Briefing System (just built, merged to main)
After every agent research run completes, `lib/agent/update-analyst-briefing.ts` calls GPT-4o-mini to generate an `AnalystBriefing` row containing:
- `narrative` — 400-600 word markdown portfolio briefing using `$TICKER` format (renders as ticker chips)
- `strategyNotes` — 100-200 word strategy adjustments
- `marketContext` — JSON: summary, rankedPicks, riskNotes, overallAssessment
- `theses` — array of ThesisCardData (the theses from that run)
- `trades` — array of TradeCardData (the trades placed that run)
- `portfolioSnapshot` — JSON: openPositions, totalInvested, closedPnl, winRate, wins, losses, totalTrades, totalRuns

This briefing is then injected into the NEXT run's system prompt (last 3 briefings), creating a feedback loop where the agent learns from its own history.

### Analyst Detail Page (`/analysts/[id]`)
Two-column layout:
- **Left column**: Header (name, stats, Run button, config gear) + Tabs
  - **Briefings tab (1st)**: `BriefingFeed` → `BriefingCard` for each briefing (expandable, shows PortfolioSnapshotBar, narrative via TickerMarkdown, strategyNotes, ThesisCard[], TradeCard[])
  - **Overview tab (2nd)**: Core strategy prompt (analystPrompt) as Markdown
- **Right column**: Equity curve chart (or "No closed trades" empty state) + trade list

### Agent Run System (the gold standard)
`AgentThread.tsx` (1,303 lines) registers 15 tool UIs via `useAssistantToolUI`:
- `get_market_overview` → MarketContextCard
- `scan_candidates` → ScanResultsCard
- `get_stock_data` → StockCard + PostList carousel
- `get_technical_analysis` → TechnicalCard
- `get_earnings_data` → EarningsCard
- `get_options_flow` → OptionsFlowCard
- `get_reddit_sentiment` → XPost cards
- `get_twitter_sentiment` → XPost cards
- `get_sec_filings` → SecFilingsCard
- `get_analyst_targets` → AnalystTargetsCard
- `get_company_peers` → PeersCard
- `get_news_deep_dive` → PostList carousel
- `show_thesis` → ThesisArtifactSheet
- `place_trade` → OrderConfirm (pending) / TradeCard (filled)
- `summarize_run` → RunSummaryCard

Every tool UI shows ChainOfThought loading state while pending, domain card when complete, and SourceChips footer with provider citations.

### Builder & Editor Chat Systems
- **Builder** (`/analysts/new`): 10 tools (suggest_config + 6 inline web/stock tools + 4 research pipeline tools). Uses GPT-4o.
- **Editor** (floating chat on `/analysts/[id]`): 7 tools (suggest_config + web/reddit/market + research pipeline). Uses GPT-4o.
- Tool UIs registered in `components/assistant-ui/tool-uis.tsx` via `useRegisterBuilderToolUIs()` and `useRegisterEditorToolUIs()`.
- Builder/editor have their own inline tool implementations (get_stock_quote, get_trending_stocks, web_search, get_market_context, search_reddit) that are SEPARATE from the agent's 14 tools.

### What's NOT Built Yet
1. **Run followup chat** — `useRegisterFollowupToolUIs()` hook exists in tool-uis.tsx (registers 10 tools) but NO consuming component (`RunFollowupChat`) or API route (`/api/chat/run-followup`) exist.
2. **Builder/editor don't render rich domain cards** — They have stock/market tools but render custom inline components (StockQuoteRender, MarketContextRender), NOT the domain cards (StockCard, MarketContextCard) that the agent uses.
3. **Performance page analyst breakdown** — The `/performance` page exists with equity curve, win rate, direction charts. But the per-analyst performance comparison is basic.

### Domain Components Available (components/domain/)
ThesisCard, TradeCard, TradeConfirmation, MarketContextCard, StockCard, TechnicalCard, EarningsCard, OptionsFlowCard, ScanResultsCard, NewsCard, SecFilingsCard, AnalystTargetsCard, PeersCard, RunSummaryCard, ResearchStepCard, AgentConfigCard

### Manifest UI Components (components/manifest-ui/)
XPost, PostCard, PostList, ProductList, OrderConfirm, QuickReply — all use semantic prop structure: data, actions, appearance, control.

### RULES — EVERY SESSION MUST FOLLOW
1. **ShadCN only** — ONLY use components from `components/ui/`. NEVER add custom className overrides to ShadCN components. Use only their built-in variants and sizes.
2. **Reuse domain cards** — Use existing domain components from `components/domain/`. NEVER create new card components if an existing one can display the data.
3. **AI SDK v6** — useChat sends UIMessage[] (parts array). Tool parts: `part.type === "tool-{toolName}"`, `part.state === "output-available"` when done.
4. **@assistant-ui/react** — useAssistantToolUI for tool rendering. DefaultChatTransport for chat transport.
5. **No new files unless necessary** — Prefer editing existing files over creating new ones.
6. **Tailwind color rules** — Positive P&L: `text-emerald-500` ONLY. Negative: `text-red-500` ONLY. No hardcoded hex. Use CSS variables.
7. **Typography** — Page titles: `text-2xl font-semibold`. Section headers: `text-lg font-medium`. Body: `text-sm text-muted-foreground`. Labels: `text-xs font-medium uppercase tracking-wide`. Numbers: always `tabular-nums`.
8. **Empty/loading/error states** — Every data fetch must handle all three states.
9. **Models** — GPT-4.1 for agent + crons. GPT-4o for builder/editor chats. GPT-4o-mini for lightweight summaries. Do NOT change the agent model.
10. **Do NOT touch** the morning-research cron, price-monitor, trade-evaluator, or accuracy-scorer. They work.
```

---

## Session 1: Unified Tool UI Registry

```
## YOUR TASK: Unify the tool UI rendering system

You are working on the Hindsight trading platform. Your ONLY job is to make the builder and editor chats render the SAME rich domain cards that the agent run uses, by creating a shared tool UI registry.

### The Problem
Right now there are THREE separate tool UI registration systems:
1. `AgentThread.tsx` — 15 inline `useAssistantToolUI` calls rendering domain cards (MarketContextCard, StockCard, etc.)
2. `tool-uis.tsx: useRegisterBuilderToolUIs()` — registers custom inline renders (StockQuoteRender, MarketContextRender, etc.) that are NOT the domain cards
3. `tool-uis.tsx: useRegisterEditorToolUIs()` — same custom renders as builder

The builder has a `get_market_context` tool that renders a custom `MarketContextRender` component. The agent has `get_market_overview` that renders the real `MarketContextCard`. These are two different components showing similar data in different formats. Same story for stock quotes, reddit sentiment, etc.

### What You Must Do

**Step 1: Extract tool UI registrations from AgentThread.tsx into a shared hook**

Create a `useRegisterResearchToolUIs()` function (in `components/assistant-ui/tool-uis.tsx`) that registers the 14 research tool UIs currently defined inline in `AgentThread.tsx`. Each tool UI should render the same domain card it renders now — just extracted into the shared file.

The pattern for each tool UI in AgentThread is:
- Pending state: ChainOfThought loading animation
- Complete state: Domain card (MarketContextCard, StockCard, etc.) + SourceChips footer
- These should work identically when extracted

AgentThread.tsx should then call `useRegisterResearchToolUIs(runId)` instead of having all 15 inline registrations.

**Step 2: Make builder/editor tool UIs use domain cards where possible**

The builder/editor have these tools with custom renders that should use domain cards instead:
- `get_market_context` → should render `MarketContextCard` (same as agent's `get_market_overview`)
- `get_stock_quote` → should render `StockCard` (same as agent's `get_stock_data`)
- `search_reddit` → should render XPost cards (same as agent's `get_reddit_sentiment`)

The data shapes from builder tools may differ from agent tools. You'll need to check the actual tool return values in the builder route (`app/api/chat/analyst-builder/route.ts`) and map them to the domain card props if needed.

Keep `suggest_config` rendering as-is (AgentConfigCard for builder, diff view for editor) — those are unique to builder/editor.

Keep `web_search`, `get_trending_stocks`, and research pipeline tools (`research_ticker`, `get_thesis`, `compare_tickers`, `explain_decision`) as-is — their current renders are fine.

**Step 3: Clean up**

- Remove the now-duplicated inline tool UIs from AgentThread.tsx
- Remove the old custom render components from tool-uis.tsx that were replaced by domain cards
- Make sure the `useRegisterFollowupToolUIs()` hook still works (Session 2 will consume it)

### What NOT To Do
- Do NOT change any tool definitions (the `tool()` calls in route files)
- Do NOT change domain card components
- Do NOT modify the agent route, builder route, or editor route API logic
- Do NOT add new tools
- Do NOT touch anything in `lib/inngest/`
- Do NOT create new component files for cards — reuse existing domain components

### Expected Output
- `AgentThread.tsx` is significantly shorter (tool UIs extracted out)
- `tool-uis.tsx` has a new `useRegisterResearchToolUIs(runId)` hook
- Builder/editor chats now render MarketContextCard, StockCard, XPost for their market/stock/reddit tools
- All existing functionality preserved — runs, builder, editor all still work

### Key Files
- `components/research/AgentThread.tsx` — extract FROM here
- `components/assistant-ui/tool-uis.tsx` — extract INTO here
- `components/domain/index.ts` — all domain card exports
- `app/api/chat/analyst-builder/route.ts` — check tool return shapes
- `app/api/chat/analyst-editor/route.ts` — check tool return shapes

Commit with clear messages and push when done.
```

---

## Session 2: Run Followup Chat + Performance Page Polish

**RUN THIS AFTER SESSION 1 MERGES** — it modifies AgentThread.tsx which Session 1 also touches.

```
## YOUR TASK: Build the run followup chat and polish the performance page

You are working on the Hindsight trading platform. Your job has TWO parts:

### PART A: Run Followup Chat

After a research run completes, the user should be able to ask follow-up questions and take actions (place additional trades, close positions, dig deeper on a ticker). The infrastructure is partially built but disconnected.

**What exists:**
- `useRegisterFollowupToolUIs()` in `components/assistant-ui/tool-uis.tsx` — registers 10 tool UIs (research_ticker, place_trade, close_position, modify_position, add_to_position, portfolio_status, compare_tickers, performance_report, explain_decision, run_summary)
- `HindsightComposer` component — chat input with ticker search and slash commands
- `AgentThread.tsx` — already has a composer at the bottom that says "Ask a follow-up question…"

**What does NOT exist:**
- `/api/chat/run-followup/route.ts` — the API route to handle followup messages
- The followup tools themselves (the tool definitions that match what `useRegisterFollowupToolUIs` expects)

**What you must build:**

1. **Create `app/api/chat/run-followup/route.ts`**
   - AI SDK v6 `streamText` endpoint (same pattern as `app/api/research/agent/route.ts`)
   - Model: GPT-4o (this is conversational, not autonomous research)
   - Accept `runId` and `analystId` in the request body
   - Load context: the run's theses, trades placed, analyst config, open positions
   - Define followup tools:
     - `research_ticker` — get stock data + technical analysis for a ticker (reuse logic from `lib/agent/tools.ts`)
     - `place_trade` — place an additional paper trade via Alpaca (reuse from agent tools)
     - `close_position` — close an open position (reuse from agent tools or `lib/alpaca.ts`)
     - `portfolio_status` — show current open positions with live P&L
     - `compare_tickers` — compare 2-3 tickers side by side
     - `explain_decision` — explain why a trade was/wasn't placed during the run
   - System prompt: "You are a trading assistant. The user just completed a research run. Help them with follow-up questions about the run's findings, place additional trades, or manage positions. Here's what happened in the run: [inject run context]"

2. **Wire AgentThread to use followup mode after run completes**
   - When the run status is COMPLETE (not RUNNING), the composer should POST to `/api/chat/run-followup` instead of `/api/research/agent`
   - Register the followup tool UIs (`useRegisterFollowupToolUIs()`) in addition to the research tool UIs
   - The followup chat should appear seamlessly below the completed run messages

3. **Add QuickReply pills after run completes**
   - After `summarize_run` renders, show QuickReply pills (from `components/manifest-ui/`) with suggested follow-ups like: "Show portfolio status", "Research [top pick ticker]", "Place a trade on [ticker]"
   - QuickReply component already exists — use it with its standard props

### PART B: Performance Page — Analyst Breakdown

The performance page (`app/(root)/performance/`) already has equity curve, win rate, and direction charts. Add an **analyst performance comparison** section.

**What to add:**
- A section showing each analyst's performance side-by-side
- For each analyst: name, win rate, total P&L, number of trades, best trade, worst trade
- Use existing ShadCN Table or Card components
- Data is available via Prisma — query trades grouped by `agentConfigId` with the related AgentConfig
- Add this as a new section at the bottom of the existing performance page

### What NOT To Do
- Do NOT modify the agent run route (`/api/research/agent/route.ts`) — followup is a SEPARATE route
- Do NOT modify domain card components
- Do NOT modify tool-uis.tsx (Session 1 handles that)
- Do NOT touch `lib/inngest/` crons
- Do NOT create new card components — use existing domain cards and ShadCN components
- Do NOT restructure the performance page — just ADD the analyst breakdown section

### Expected Output
- New file: `app/api/chat/run-followup/route.ts` with streaming followup chat
- Modified: `AgentThread.tsx` — switches to followup transport after run completes, shows QuickReply pills
- Modified: Performance page — new analyst comparison section at bottom
- All existing run functionality preserved

### Key Files
- `app/api/research/agent/route.ts` — reference for route pattern (DO NOT MODIFY)
- `components/research/AgentThread.tsx` — wire followup mode here
- `components/assistant-ui/tool-uis.tsx` — `useRegisterFollowupToolUIs()` already exists
- `components/manifest-ui/quick-reply.tsx` — QuickReply component
- `lib/agent/tools.ts` — reuse tool logic from here
- `lib/alpaca.ts` — Alpaca client for trade execution
- `app/(root)/performance/page.tsx` — add analyst section here

Commit with clear messages and push when done.
```

---

## Session 3: Agent Polish — Portfolio Review Step + Trade Evaluation Feedback

Can run in PARALLEL with Session 1 (no file conflicts).

```
## YOUR TASK: Add portfolio review to the agent run and feed trade evaluations back

You are working on the Hindsight trading platform. Your job is to make the agent smarter by adding two pieces:

### PART A: Portfolio Review Phase

Currently the agent's 6 phases are: Market Context → Scan → Deep Research → Thesis → Trade Decision → Summarize. The agent places trades immediately after each thesis if confidence >= threshold, without considering the full picture.

**Add a portfolio review step between Phase 5 (Trade) and Phase 6 (Summarize):**

1. **Modify `lib/agent/system-prompt.ts`**
   - After Phase 5 (Trade Decision), add Phase 5.5: Portfolio Review
   - Instructions: "Before summarizing, review ALL theses generated this session alongside your current open positions. Consider: total portfolio exposure, sector concentration, correlation between new and existing positions, daily loss limits, and max position count. If you placed multiple trades, confirm the combined risk is acceptable. If you're overexposed to a sector or direction, note this in your summary."
   - This is prompt-only — no new tool needed. The agent already has the context (open positions are injected) and can reason about it in its narrative before calling `summarize_run`.

2. **Enhance `summarize_run` tool output**
   - In `lib/agent/tools.ts`, modify the `summarize_run` tool's schema to accept an optional `portfolio_review` field (string) where the agent writes its portfolio review assessment
   - The RunSummaryCard already shows `risk_notes` — make sure portfolio review content flows into that field or a new section

### PART B: Trade Evaluation Feedback Loop

The `trade-evaluator.ts` Inngest cron runs GPT-4o to evaluate closed trades, generating a narrative about what went right/wrong. This evaluation is stored on TradeEvent rows but is NOT fed back into the next run's context.

**Feed trade evaluations into the run context:**

1. **Modify `app/api/research/agent/route.ts`** (the history block builder)
   - In the "Recent Trade History" section (around lines 179-189), for each closed trade, also query the latest TradeEvent with type "EVALUATED" for that trade
   - Include the evaluation narrative (truncated to ~200 chars) alongside each trade's W/L and P&L data
   - Format: `"WIN | LONG AAPL | +$45.20 | Eval: Strong entry timing, took profit near resistance as planned"`

2. **Do the same in `lib/inngest/functions/morning-research.ts`**
   - The morning cron builds the same history block — add evaluation data there too
   - Keep the same format as the agent route

### What NOT To Do
- Do NOT change tool definitions except `summarize_run` schema
- Do NOT modify domain card components
- Do NOT modify the briefing system
- Do NOT change models
- Do NOT modify tool-uis.tsx or AgentThread.tsx
- Do NOT touch the trade-evaluator, price-monitor, or accuracy-scorer crons themselves — just READ their output
- Do NOT add new tools — this is about improving the existing flow

### Expected Output
- Modified: `lib/agent/system-prompt.ts` — new portfolio review phase in instructions
- Modified: `lib/agent/tools.ts` — `summarize_run` schema accepts `portfolio_review`
- Modified: `app/api/research/agent/route.ts` — trade evaluations in history block
- Modified: `lib/inngest/functions/morning-research.ts` — same evaluation data in cron context
- Agent now considers portfolio holistically before summarizing, and learns from specific trade evaluations

### Key Files
- `lib/agent/system-prompt.ts` — add portfolio review phase
- `lib/agent/tools.ts` — modify summarize_run schema
- `app/api/research/agent/route.ts` — add evaluation data to context
- `lib/inngest/functions/morning-research.ts` — same context enhancement
- `lib/inngest/functions/trade-evaluator.ts` — READ ONLY, understand what TradeEvent data looks like
- `prisma/schema.prisma` — READ ONLY, understand TradeEvent model

Commit with clear messages and push when done.
```
