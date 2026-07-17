## NEVER add custom classes to ShadCN components. Use them as-is with only variants and sizes. Do not override styling with className overrides.

# CLAUDE.md — Hindsight Trading Platform

## What This App Is
AI-powered paper trading simulator. An autonomous AI agent
researches stocks, generates trade theses, places paper trades
via Alpaca, tracks performance, and learns from results.
Built for one user now, marketed later.

## The Trigger Game Plan (shipped 2026-07-12 — read before touching anything trigger/position-related)
Every thesis carries a **trigger ladder** (condition → action: ENTER/ADD/TRIM/
EXIT/REVIEW) the agents author and maintain. New predicates `GAIN_FROM_ENTRY`
(cumulative % vs entry) + `TRAILING_FROM_HIGH` (give-back off the tracked
peak) protect gains. Every HOLDING auto-carries standing minimums (+10%
checkpoint REVIEW / 8% trail EXIT / −12% loser REVIEW, `defaults.ts`) —
stamped at mint AND at the buy fill (`place-trade.ts` held-side re-seed).
`resolved.ladderHealth` + the `UNPROTECTED_GAIN` needsAction flag nag winners
whose floor lags their gain; `complete_run` warn-gates unprotected holdings.
Everything fires as approval-gated proposals — nothing auto-trades. The three
docs: `docs/plans/TRIGGER_MODEL.md` (conceptual shape),
`docs/plans/TRIGGER_LIFECYCLE.md` (authority/visibility contract),
`docs/plans/THESIS_GAME_PLAN.md` (the blueprint + IONS motivating failure).
Gotcha: `update_thesis.triggers` is wholesale-REPLACE — resend every rung you
keep. Signal-side rungs (earnings/filing/news) can't fire today — routing is
deliberately paused (GAPS P1-34; design doc `docs/plans/SIGNALS_REDESIGN.md`).

## Where to put what (doc navigation)
| You want to... | File |
|---|---|
| Understand the agent design rules (three-layer principle) | `docs/PRINCIPLES.md` |
| Read / update the product north star | `docs/VISION.md` |
| Read the live thesis-system reference | `docs/THESIS_ARCHITECTURE.md` |
| Understand triggers (predicates, which fires on which path, fire modes) | `docs/TRIGGERS.md` |
| **The trigger CONCEPTUAL model (condition·action·mode·timing; what is/isn't a trigger)** | **`docs/plans/TRIGGER_MODEL.md`** |
| **Trigger authority + visibility contract (who sets which level, when; what wakes an agent)** | **`docs/plans/TRIGGER_LIFECYCLE.md`** |
| **Why the trigger ladder exists (conviction management: press winners / protect gains)** | **`docs/plans/THESIS_GAME_PLAN.md`** |
| Add an open item on the thesis architecture rework | `docs/GAPS.md` |
| Note a code smell outside the rework | `docs/TECH_DEBT.md` |
| Spec a big multi-PR plan | `docs/plans/<NAME>.md` |
| Write a daily run review | `docs/run-reviews/<YYYY-MM-DD>.md` |
| Write a discovery run review | `docs/discovery-reviews/<YYYY-MM-DD>-<TICKER>.md` |
| Kick off a code session | `docs/prompts/SESSION_BOOTSTRAP.md` |
| Kick off a run-review session | `docs/prompts/REVIEW_DAILY_RUN.md` |
| **Find discovery query templates per analyst (Grok / Perplexity / Reddit)** | **`docs/DISCOVERY_PLAYBOOK.md`** |
| **Reference why the analyst lineup looks like it does** | **`docs/plans/ANALYST_LINEUP.md`** |
| Reference what shipped in a PR | GitHub PRs |
| Onboard a fresh session to the codebase | `CLAUDE.md` |

**Rule:** when an item in `GAPS.md` closes, **move it** to a "Done since" section in the same file (not strike-through inline). When the file's open list grows past one screen, move stale items to `TECH_DEBT.md` or close them.

## Stack — DO NOT DEVIATE
- Next.js App Router, TypeScript
- ShadCN + Tailwind CSS only for UI
- Supabase (Postgres + Auth + Realtime)
- Prisma ORM (v7 with adapter-pg)
- Inngest for background jobs and crons
- Vercel (Next.js only — no Railway)
- Vercel AI SDK v6 + AssistantUI (@assistant-ui/react)
- TradingView Lightweight Charts for price charts
- Recharts for performance/analytics charts

## Architecture — Agent + Intelligence Pipeline

### The Agent (what the "Run" button and morning cron both use)
- User clicks "Run" → POST /api/research/agent-run creates ResearchRun
- Redirects to /runs/[id] → renders AgentThread component
- AgentThread uses AI SDK v6 useChat → POST /api/agent/research-run
- GPT-5.5 (maxSteps 65, temperature 0.2) + the full tool catalog
  autonomously researches, updates theses, manages positions, and
  places trades via Alpaca
- Tools render via ToolCallGroup → ToolCallRow dispatching on result.ui
- All research persisted to DB via tool execute functions
- Morning cron (8 AM ET) runs same agent via generateText

## Universe (the analyst's discovery fence)
The "Universe" is the set of fields on AgentConfig that define what the
analyst will look at. Used by signal routing (filter signals into the
inbox) and by the agent (which discovery candidates are in-scope).

Universe fields on AgentConfig:
- `markets` — ["US_EQUITIES", "CRYPTO", "ETFS"]
- `exchanges` — ["NASDAQ", "NYSE"]
- `sectors` — broad GICS-style ["Technology", "Energy", ...]
- `industries` — narrower GICS ["Semiconductors", "Auto Manufacturers", ...]
- `themes` — analyst-defined ["AI infrastructure", "EV transition", "GLP-1", ...]
- `feeds` — firm-aggregate firehoses ["EARNINGS_CALENDAR", "MARKET_MOVERS_GAINERS",
  "MARKET_MOVERS_LOSERS", "MARKET_MOVERS_ACTIVES"]. Canonical values mirror
  `Signal.aggregateType` 1:1 (see lib/universe/feeds.ts). Same fence semantic
  as the other dimensions. Composition: an analyst with `feeds:["EARNINGS_CALENDAR"]`
  + `industries:["Semiconductors"]` ends up with the calendar fenced to semis names.
- `marketCapMin` / `marketCapMax` — BigInt? in dollars; null = no bound
- `exclusionList` — tickers/industries always skipped (hard reject)
- `tickerUniverse` — DIRECTED-mode seed list (separate concept, kept as-is)

Match semantics (signal routing): empty array / null numeric = no filter
on that dimension. AND across dimensions, OR within. exclusionList wins.
See docs/AGENT_OVERHAUL_PLAN.md → Workstream B for the full spec.

Routing output on AnalystSignalRoute (populated by Workstream A):
- `routeReasonCode` — "DISCOVERY" | "WATCHLIST" | "POSITION" | "DIRECT_TICKER"
  | "SECTOR_MATCH" | "INDUSTRY_MATCH" | "THEME_MATCH" | "CROSS_ANALYST"
  | "FIRM_AGGREGATE_FEED" | "AGGREGATE_TICKER_MATCH"
- `matchedUniverse` Json — { sectors, industries, themes, inWatchlist,
  inPositions, fromAnalystId?, feed? }

### Three access tiers for firm-aggregate signals
Firm aggregates (earnings calendar, market movers, future insider/options flow)
reach analysts via three orthogonal paths. Pick the right one by intent, don't
add a fourth.

1. **Subscription push** — `AgentConfig.feeds` includes the aggregate's type.
   The full firehose routes into `read_signals` automatically. Earnings
   Catalyst archetype → `feeds:["EARNINGS_CALENDAR"]`; Momentum Breakout
   → `feeds:["MARKET_MOVERS_GAINERS","MARKET_MOVERS_ACTIVES"]`.

2. **Universe-intersection push** — the aggregate's tickers intersect with the
   analyst's watchlist + open positions (router-side). Even an analyst with no
   feed subscription gets a *fenced* view: "3 of your watchlist names are on
   today's most-active list." This path is the right answer to "I want to know
   when MY names move" without subscribing to the full firehose.

3. **On-demand pull tools** — `get_earnings_calendar`, `get_market_movers`. Any
   analyst can call them mid-run regardless of subscription. Use `scope:"universe"`
   to fence to watchlist + positions; `scope:"all"` for the full firehose.

Defaults are seeded by archetype via `defaultFeeds` on each StrategyArchetype
in `lib/agent/knowledge/strategy-archetypes.ts`. Builder reads it via
`read_knowledge_library` and includes the matching feeds in `suggest_config`.

### V3 Intelligence Pipeline (background, pre-run)
- 4 Inngest jobs run 6:30–7:30 AM ET before analysts wake up
- Firm market sweep: Perplexity Sonar + FMP movers + Finnhub earnings
- Portfolio/watchlist monitor: Sonar per-ticker searches
- Domain monitor: domain-filtered Sonar + Firecrawl extraction
- Signal router: scores and routes signals to analysts; emits
  `app/signal.routed` for the trigger evaluator to consume
- Morning brief generator was DELETED in PR 3 — agent reads durable
  state directly via `read_signals` + `get_theses(include_history: true)`
- Trigger evaluator (separate cadence): runs every 5 min during regular
  US market hours (gated on `isMarketOpen()`) + on `app/signal.routed`,
  fires `app/thesis.trigger.fired` when a thesis predicate matches, which
  wakes a tactical run. See `docs/TRIGGERS.md`.

### Data Sources
- Finnhub: quotes, candles, earnings calendar, company metrics,
  news, recommendations (PRIMARY for all quote data)
- FMP: market movers (gainers/losers/actives), analyst targets,
  options chain, economic calendar
  NOTE: FMP /quote/ endpoint is DEPRECATED (403 on legacy plans).
- Alpaca: paper trade execution, order fill, position tracking
- Perplexity Sonar: web search for intelligence pipeline + agent
- Firecrawl: full-page extraction for artifacts
- SEC EDGAR: filings (10-K, 10-Q, 8-K, Form 4)

## Data Model (Prisma)
### Core
- AgentConfig — analyst persona config (name, analystPrompt,
  sectors, signals, confidence threshold, direction bias,
  hold durations, position sizing, watchlist, exclusionList,
  intelligencePolicy)
- ResearchRun — one execution; links to AgentConfig; status
  (RUNNING/COMPLETE/FAILED); parameters JSON snapshot
- RunEvent — SSE event from a run (type, title, message, payload)
- RunMessage — persisted AI SDK messages for run replay
- Thesis — stock analysis (direction, confidence, reasoning,
  bullets, risk flags, signal types, sourcesUsed, entry/target/stop).
  **Status taxonomy (P1-24 — see `docs/plans/STATUS_TAXONOMY.md`):**
  `status` = WATCHING | HOLDING | PASSED | RETIRED (+`retiredReason`
  DROPPED/SOLD/INVALIDATED/REPLACED) | PROMOTED; `direction` = LONG | SHORT | null.
  Legacy mapping: ACTIVE→HOLDING, direction=PASS→PASSED,
  CLOSED/INVALIDATED/ARCHIVED/SUPERSEDED→RETIRED, direction=PENDING→null.
  Agent INPUT keeps aliases — `record_thesis(direction:'PASS')` and
  `update_thesis(change_status:'INVALIDATED'/'ARCHIVED')` are still accepted and
  translated to the clean stored values; the change_status ACTIVE/CLOSED and
  direction PENDING inputs were removed.
- Position — paper position via Alpaca (symbol, direction, avgCost,
  qty, status, closePrice, outcome, agentEvaluation)
- PositionEvent — position lifecycle log (OPENED, PRICE_CHECK,
  NEAR_TARGET, CLOSED, EVALUATED)
- AccuracyReport — weekly per-analyst calibration
### Intelligence (V3)
- Monitor — unified tracked item (SEARCH/DOMAIN/API type, method,
  config JSON, scope, analyst link, lastRunAt)
- Signal — normalized evidence unit (headline, summary, tickers,
  themes, sentiment, urgency, sourceUrls)
- SignalBatch — groups signals by job run for dedup
- AnalystSignalRoute — signal→analyst routing with relevance score
- Artifact — extracted page content (markdown, summary, contentHash)
- MorningBrief — per-analyst daily brief (market context,
  portfolio alerts, watchlist updates, new opportunities, risk flags)

## Pages
- / (Dashboard) — MarketPulseStrip (Finnhub WebSocket), portfolio
  summary, Today's Picks, AgentActivityLog
- /analysts — analyst card grid with enable/disable toggles
- /analysts/new — AI-driven analyst creation (AnalystBuilderChat)
- /analysts/[id] — 2-col: Overview + config | floating editor chat;
  tabs for Runs and Trades
- /runs — research run feed with status dots, analyst names,
  thesis counts, logo stacks
- /runs/[id] — run detail with 2 render modes:
  - AgentThread (live agent, agentMode=true + RUNNING)
  - RunUnifiedChat (completed runs, events→chat)
- /trades — paper trade list with live P&L
- /performance — accuracy reports, win rate charts
- /stocks — stock search
- /stocks/[symbol] — TradingView chart + stock detail
- /intelligence — intelligence dashboard (signals, monitors, briefs,
  activity, manual job triggers)
- /agent-workflow — visual "How Hindsight Works" guide
- /settings — app settings

## API Routes
- /api/agent/[mode] — unified agent route. Modes:
  - research-run: GPT-5.5, temperature 0.2, maxSteps 65 (the daily-run agent)
  - builder: GPT-4o, research tools only + suggest_config
  - editor: GPT-4o, research tools only + suggest_config
  - tactical: GPT-5.5, maxSteps 15 (single-thesis, single-decision)
  - discovery: GPT-5.5, maxSteps 45 (weekly Sunday cron)
  - podcast-builder / podcast-segment-run / podcast-editor
- /api/research/agent-run — creates ResearchRun row, returns runId
- /api/research/trigger — Inngest manual trigger
- /api/chat/run-followup — post-run discussion with trade tools
- /api/agent-activity — dashboard activity stream
- /api/intelligence/* — signals, monitors, briefs, activity CRUD
- /api/quotes — Finnhub quote fallback
- /api/stocks/search — Finnhub symbol search
- /api/inngest — Inngest webhook handler

## Agent Tools — 24 trading tools (lib/agent/tools/)
Each tool is defined in its own file using `defineTool()` from
`lib/agent/define-tool.ts`. The factory wraps execute() in timing/
logging/try-catch and returns a `ToolResult<T>` envelope with a `ui`
discriminator that drives rendering in ToolCallRow. Three additional
podcast-only tools (`read_past_transcripts`, `suggest_podcast_config`,
`write_segment_transcript`) live alongside but are out of scope for the
trading workflow — see `lib/podcast/` and `docs/PODCAST_PLAN.md`.

### Intelligence Tools (read pre-gathered data)
1. read_signals — signals routed by background discovery jobs
2. read_artifact — full extracted article/document behind a signal
3. get_theses — read the analyst's durable thesis library (default HOLDING+WATCHING; include_history=true for the activity log)
4. get_portfolio_context — open positions, exposure, available buying power, recent fills
5. web_search — live Perplexity Sonar search (budget-limited)
   NOTE: read_morning_brief was DELETED in PR 3 — agent reads
   durable state directly via read_signals + get_theses

### Research Tools (live data validation)
6. get_market_context — SPY/VIX/sector ETFs, macro events, regime
7. get_stock_data — quote + company profile + financials + technicals + news
8. get_earnings_data — per-ticker EPS history, beat rate, next report date
9. get_earnings_calendar — firm-wide upcoming earnings calendar; `scope:"universe"`
   fences to watchlist + positions, `scope:"all"` returns the full firehose.
   Pull-tool counterpart to the `EARNINGS_CALENDAR` feed subscription.
10. get_market_movers — today's gainers / losers / most-actives from FMP;
    `scope:"universe"` fences to watchlist + positions, `scope:"all"` returns
    the full top list. Pull-tool counterpart to the `MARKET_MOVERS_*` feeds.
11. get_options_flow — put/call ratio, unusual contracts
12. get_sec_filings — SEC EDGAR filings

### Action Tools
13. record_thesis — mint a NEW thesis (direction LONG/SHORT/PASS) for net-new coverage or direction flip. PASS lands status=PASSED (institutional memory). Unresearched watchlist seeds (direction=null, status=WATCHING) are minted only by non-agent code paths (UI/builder/editor) — agents can't mint them.
14. update_thesis — patch an existing thesis durably (writes one ThesisUpdate audit row: UPDATED, REVIEWED, or STATUS_CHANGED; change_status accepts INVALIDATED/ARCHIVED/PASS as input aliases → stored as RETIRED+retiredReason or PASSED — the ACTIVE/CLOSED change_status verbs were removed). The single most-used tool — every daily-run REVIEWED entry, every tactical close-out, and every "remove from watchlist" is one of these.
15. place_trade — Alpaca market order, creates Position, flips paired Thesis WATCHING→HOLDING and writes STATUS_CHANGED audit row.
16. close_position — close an existing open position fully; flips Thesis HOLDING→RETIRED (retiredReason=SOLD).
17. manage_position — partial close, scale in/out, move stop, trail stop, adjust target.
18. record_run_summary — persist run summary + ranked picks + decision rationale; runs the narration-gate verb→tool gate.
19. complete_run — mark run COMPLETE (only allowed from RUNNING; FAILED status set by the narration-gate sticks).

NOTE: `manage_watchlist` was deleted 2026-05-13 in the watchlist collapse. To add to a watchlist, mint a `Thesis(direction=null, status='WATCHING')`. To remove, call `update_thesis(change_status='ARCHIVED')` (input alias → lands status=RETIRED, retiredReason=DROPPED).

### Builder/Editor-only Tools
20. read_knowledge_library — strategy archetypes, source catalog, signal types
21. ask_question — structured 2-5 quick-reply interview, one call per turn
22. discover_signals_for_fence — validate a proposed sectors/industries/themes/tickers fence against the past 30d of routed signals
23. read_analyst_inbox_stats — 30-day routing rollup for THIS analyst (top tickers, dead themes, hot unwatched tickers)
24. suggest_config — emit the full proposed analyst config as a side-panel diff

## How to Add a New Agent Tool

1. **Create `lib/agent/tools/my-tool.ts`**
   ```ts
   import { z } from "zod";
   import { defineTool } from "@/lib/agent/define-tool";

   export const myTool = defineTool({
     description: "...",
     schema: z.object({ ticker: z.string() }),
     ui: "ticker",         // one of: generic | ticker | source | stock-card |
                           //   trade-card | thesis-card | portfolio |
                           //   decision-summary | config-preview
     groupId: "research",  // optional — groups tool calls visually in chat

     execute: async (args, ctx) => {
       // ctx: { runId, userId, analystId?, watchlist?, alpacaCreds?, ... }
       const data = await fetchSomething(args.ticker);
       return {
         summary: `Fetched ${args.ticker}`,   // shown in compact row
         data,                                  // drives the renderer
         sources: [],                           // optional ToolSource[]
       };
     },
   });
   ```

2. **Export from `lib/agent/tools/index.ts`**
   ```ts
   export { myTool } from "./my-tool";
   ```

3. **Register in `lib/agent/tools/index.ts`** (the `createResearchTools()` wrapper)
   ```ts
   import { myTool } from "@/lib/agent/tools/my-tool";
   // inside createResearchTools():
   my_tool: myTool(newCtx),
   ```

4. **Add to mode allowlist if needed** in `lib/agent/modes.ts`
   (builder/editor have restricted allowlists; research-run allows all)

5. **Wire a renderer if `ui` is new** in `components/agent/ToolCallRow.tsx`
   or pick an existing renderer from `components/agent/renderers/`

**ToolResult shape** (what the route streams, what renderers receive):
```ts
{ ok: true, ui, groupId?, summary, data, sources }  // success
{ ok: false, error, retryable, sources }             // failure
```

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
### Intelligence Pipeline (6:30–7:30 AM ET Mon-Fri)
- firm-market-sweep.ts — 6:30 AM, Sonar + FMP movers + earnings
- portfolio-watchlist-monitor.ts — 7:00 AM, per-ticker Sonar
- domain-monitor.ts — 7:15 AM, domain Sonar + Firecrawl
- signal-router.ts — 7:30 AM, routes signals + emits app/signal.routed
- (morning-brief-generator.ts was DELETED in PR 3 — agent reads
  durable state directly via read_signals + get_theses)
### Reactivity (PR 2)
- trigger-evaluator.ts — hourly during market hours + on
  app/signal.routed; fires app/thesis.trigger.fired when a thesis
  predicate matches
- tactical-run.ts — event-driven, consumes app/thesis.trigger.fired,
  spawns a focused single-thesis agent (~15 steps)
### Agent + Trading
- morning-research.ts — 8 AM ET Mon-Fri, per-analyst Daily Run
- discovery-run.ts — Sundays 9 AM ET, per-analyst weekly discovery
  scan (mints up to 5 new WATCHING theses)
- price-monitor.ts — hourly price check, exit evaluation
- trade-evaluator.ts — GPT-4o post-trade evaluation (on close)
- eod-evaluation.ts — end-of-day price snapshots
- weekly-digest.ts — Sunday 9 AM ET digest email
- accuracy-scorer.ts — Sunday 10 AM, weekly AccuracyReport

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
2. **AgentThread** connects to `/api/agent/research-run` via ChatRuntime
3. **ToolCallGroup** (registered as the ToolGroup slot in Thread) reads all
   tool-call parts from `useMessage`, groups by `result.groupId`, and renders
   each via **ToolCallRow** dispatching on `result.ui`. **Only 5 renderers exist**
   (see "Tool UI architecture" below):
   - `tool-ui` → **ToolUIRenderer** — the ONE generic renderer. ~90% of tools
     route here. Reads `data.items[]` where each item is either ticker-kind
     (logo + chip + text) or generic-kind (dot + text). No per-tool wrappers.
   - `thesis-card` → ThesisCardRenderer → full ThesisCard with sheet
   - `run-summary` → RunSummaryRenderer → ranked-picks DecisionSummaryCard
   - `config-preview` → ConfigPreviewRenderer (builder/editor diff view)
   - `ask-question` → AskQuestionRenderer (interactive QuickReply flow)
4. Extended thinking blocks render via **Reasoning** component (collapsible)
5. Quick replies appear after run completes via **FollowupQuickReplies**.
6. For COMPLETE runs, **RunUnifiedChat** renders synthesized events.

## Tool UI architecture
The primitive is `components/ai-elements/tool-progress.tsx` (`ToolProgress` +
`ToolProgressHeader` + `ToolProgressContent` + two item components:
`ToolProgressTickerItem` for ticker rows, `ToolProgressItem` for generic prose
rows). That's the "fake chain of thought" every tool row renders into.

**Tools return items[], the renderer just iterates.** Simple tools set
`ui: "tool-ui"` and return `data.items: ToolUIItem[]` where each item is
either `{ kind: "ticker", ticker, tag?, text, actionIcon? }` or
`{ kind: "generic", text }`. `ToolUIRenderer` wraps the items in a
`ToolProgress` and maps each to the right component — no per-tool logic.

**Never invent a new renderer** for a list-shaped tool (header + items +
maybe sources). If you're tempted: add a generic row or a ticker row to
`data.items` instead. The 5 renderers listed above are the full surface —
4 specialty (thesis card, run summary table, config diff, interactive
question) and 1 generic (`ToolUIRenderer`). Adding a sixth is almost
always the wrong choice.

**Never shove non-ticker content into a ticker row.** Narrative prose
(market context, run wrap-up, a briefing status line) is a generic-kind
item. A fake `$MARKET` ticker is a bug, not a fix — the UI will render
it with a ticker chip as if it were a traded security.

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
- ToolCallGroup reads tool parts directly from useMessage — it does NOT
  use useAssistantToolUI hooks. All rendering is data-driven via result.ui.
- Prisma Json fields (sourcesUsed, parameters) typed as unknown —
  always cast with type guard
- async params in Next.js App Router: params: Promise<{ id: string }>
- FMP /quote/ endpoint DEPRECATED — use Finnhub for all quotes
- Model strategy (post-2026-05-15):
  - **research-run + tactical + discovery**: GPT-5.5 (provider: openai).
    research-run uses temperature 0.2 + maxSteps 65; tactical maxSteps 15;
    discovery maxSteps 45. Vercel Pro plan required — the 800s function
    timeout headroom is needed because gpt-5.5 with implicit reasoning
    runs ~13s/tool-call vs gpt-4o's faster cadence. modes.ts maxDuration
    is 800 for all three; the cron/route AbortSignal derives 770s from
    `(maxDuration - 30) * 1000`.
  - **builder + editor**: GPT-4o still (user-facing latency matters in
    the chat panel; gpt-5.5 would feel slow when interactively
    iterating on a fence).
  - **principal-chat**: Claude Sonnet 4.6 with thinking budget 4000.
  - **GPT-4o-mini**: lightweight summaries (trade evaluator etc.).
  - **Do NOT swap to Claude for research-run** — the 30k context limit
    crashes the run.
- Agent thinking config lives in lib/agent/modes.ts (thinkingBudget field)
- gh auth switch --user dave-sucks before pushing

## Run Flow (Button Click → Completion)
1. Click "Run" → POST /api/research/agent-run → creates ResearchRun
2. Redirect to /runs/[id] → AgentThread renders with autoStart
3. AgentThread → ChatRuntime → POST /api/agent/research-run
4. Route loads config + historical context (portfolio, watchlist,
   briefs, trades, accuracy, intelligence policy)
5. GPT-5.5 (temperature 0.2) follows the per-thesis review flow with
   Phase-0 check-in:
   Phase 0: Portfolio check-in (injected context, no tools)
   Stage 1 — Orient: read_signals (today buckets: portfolio / watchlist
     / discovery), get_theses(include_history: true), read_artifact, web_search
   Stage 2 — Per-thesis review: for every active + watching thesis,
     decide: trigger fired / new evidence → research + update_thesis;
     scheduled review due → research + update_thesis; nothing changed →
     update_thesis with REVIEWED-only audit row
   Stage 3 — Theses: update_thesis is default for held names;
     record_thesis only for net-new coverage or direction flips
     (source_kind + source_signal_ids required)
   Stage 4 — Act: close_position / manage_position for held names that
     warrant action; place_trade for new entries; update_thesis with
     change_status='ARCHIVED' to remove from watchlist. Daily run can't
     ADD to watchlist — that's Discovery's job.
   Stage 5 — Recap: record_run_summary (ranked picks + exposure)
   Stage 6 — Complete: complete_run. Old "blocked until every
     researched ticker has a thesis" gate was relaxed in #205 as a
     documented false-fail; current gate is "no work output" (no
     theses + no trades + no summary)
6. Each tool result streams with a ToolResult envelope (ok, ui, data, sources)
7. ToolCallGroup groups results by groupId; ToolCallRow dispatches on ui
8. record_thesis persists Thesis to DB + ThesisCardRenderer shows full card
9. place_trade calls Alpaca + creates Position + renders TradeCard
10. complete_run marks run COMPLETE, triggers briefing agent

## Known Issues / Tech Debt

### RECURRING BUGS — READ BEFORE TOUCHING THESE FILES

**Portfolio P&L must be net of deposits — never measure against a fixed baseline** (`lib/portfolio/contributions.ts`, `lib/actions/portfolio.actions.ts`, `components/dashboard/DashboardClient.tsx`, `lib/alpaca.ts`; still-open twin: `lib/actions/analytics.actions.ts`)
- **The model:** an account's gain is `equity − net contributed capital`, where net contributed = `Σ deposits − Σ withdrawals`. NOT `equity − $100k` and NOT `latestEquityPoint − firstEquityPoint`. A cash deposit raises equity without being a gain; measuring against a fixed seed (or a pre-deposit chart point) reports the deposit itself as profit.
- **What it looked like (2026-06-07):** funding the live account with $88k showed `+$81,275.95 / +1015.95%` on the homepage and a phantom `−$11,937` "Unrealized Gain." Root cause: `STARTING_CAPITAL = 100_000` hardcoded as the P&L baseline, and the header delta read the raw Alpaca equity curve (which steps up on every deposit). It was invisible on paper because Alpaca seeds paper at exactly $100k — so the wrong constant happened to match.
- **The fix (this is the Alpaca-recommended approach — there is no built-in deposit-adjusted P&L):** pull funding events from the account-activities endpoint (`CSD` = deposit, `CSW` = withdrawal) via `getFundingActivities()`, build `netContributed` + a deposit-adjusted P&L curve (`equity − cumulativeContributions(date)`), and measure all P&L against that. Pure, unit-tested math lives in `lib/portfolio/contributions.ts` (`contributions.test.ts`). LIVE only — paper has no real transfers and falls back to the `STARTING_CAPITAL` seed.
- **Header semantics:** "Balance" = total equity (incl. deposits); "{Range} P&L" = deposit-adjusted gain over the selected window (1D/1W/1M/1Y/Max). % base is `netContributed` for All-Time, equity-at-range-start for shorter ranges.
- **Don't reintroduce:** any `equity − STARTING_CAPITAL` math, or a header/chart delta off the raw equity curve, brings the bug straight back. Keep the deposit-adjusted curve as the single source for displayed P&L.
- **Known still-deposit-naive (follow-ups):** the `/performance` page (`analytics.actions.ts` still hardcodes `STARTING_CAPITAL`), and the chart's secondary **Unrealized-Only** + **vs-S&P** toggles. The sub-period % is simple net-deposit return, not time-weighted (slightly high if a deposit lands mid-window — TWR is the proper upgrade).

**Stage structure in the agent system prompt** (`lib/agent/system-prompt.ts`, `components/assistant-ui/cited-markdown-text.tsx`)
- The Run Flow section MUST use `### Stage N — NAME` markdown headers for each of the 6 stages. GPT-4o relies on that structural cue to treat the stage boundary as a mandatory tool-call emission point.
- Replacing the `###` headers with inline bold (e.g. `**Record theses —**`) has been tried and **destroys the run**: the model narrates the transition as prose ("I'll proceed to thesis drafting…"), generateText terminates on that text-only step, and the run ends with 0 theses, 0 trades, 0 summary. Every analyst fails identically. Do not do this — it was attempted in commit 364b63a (Apr 20 2026) and broke the entire 8 AM cron the next morning.
- GPT-4o occasionally leaks `### Stage N — NAME` verbatim into its narration output. That cosmetic issue is handled at the renderer — the h3 filter in `cited-markdown-text.tsx` (around line 342) strips any heading matching `/^(Stage|Phase)\s+\d+\s*[—–\-]/`. That renderer filter is the durable defense; it's safe to keep the headers in the prompt.
- The `FORBIDDEN OUTPUT PATTERNS` list in Section 8 of the prompt is belt-and-suspenders. Keep it. Do not rely on it alone.

**Narration→execution gap on `close_position` — escalating** (`lib/agent/system-prompts/intraday-tactical.ts`, `lib/agent/system-prompt.ts`, `lib/agent/tools/record-run-summary.ts`)
- **What it looks like:** the agent narrates "I'll close $X" / "exit $X" / "sell $X" in prose inside its run-summary or update_thesis rationale, then never calls `close_position`. The narration→execution gate at `record-run-summary.ts` catches the prose-vs-tool-call mismatch and marks the run FAILED.
- **Occurrence pattern:** 1 run failed this way on 2026-05-20 (EV Catalyst, ON), then **3 runs on 2026-05-22** (Catalyst Event Raider on MRVL+OKTA both attempts; Secular Theme on SMTC). Frequency is increasing as the agents actually start trading (post-PR #307); they're hitting the gap on close-out, not on entry.
- **Same family as the prose-termination bug below** — agent narrates intent, fails to follow through with the tool call. Different surface: that bug terminates the loop after Step-1 data tools; this one fails the close-out preflight.
- **Filed as `docs/GAPS.md` P0-12.** Has a draft fix path there (prompt-side tighten "narrating 'close X' without a close_position tool call is a run failure" in the V2 daily-run prompt's tool-call discipline block, plus a retry-from-rationale shape in `morning-research.ts`).
- **If you see a run with `Narration without tool call` in RunEvent.title** and the message mentions "close" / "exit" / "sell" — this is the bug. Don't try to patch the gate to be more lenient; the gate is correct, the agent's tool-call discipline is the problem.

**Prose-termination after Step 1's parallel data tools** (`lib/agent/system-prompt.ts`, `lib/inngest/functions/morning-research.ts`)
- 2026-05-07: 3 of 7 morning-cron runs (Catalyst Event Raider, Global Event-Driven ETF Strategist, EV Catalyst Event Trader) terminated after one round of tool calls. Toolstats showed exactly 3 calls per run: read_signals + get_portfolio_context + get_theses (all parallel). Then the model emitted a markdown thesis-by-thesis review ending with phrases like "Next, I'll proceed to..." or "Let me now focus on..." — text-only assistant turn, no tool call. AI SDK v6's generateText loop terminates when an assistant turn produces no tool calls, so the run ended at msg=4 (user → asst-with-tools → tool-results → asst-text-only).
- The existing coverage retry SHOULD have caught it but was gated behind `response?.messages` being truthy; on a text-only tail that field came back empty/undefined and the retry was bypassed. The 3 failed runs all have `count: 1` per data tool with no retry tools accumulated.
- FIXED BY: (1) "Tool-call discipline — read this first" block in `system-prompt.ts` BEFORE Step 1, naming the forbidden phrases ("Next, I'll proceed to...", etc.) and explaining that text-only turns terminate the loop. (2) `morning-research.ts` retry gate now also fires on `prematureExitViolation` (only data-loading tools called, zero action tools) and reconstructs `responseMessages` from `steps[].response.messages` when the top-level field is empty — same fallback already used by the persistence block. The retry's nudge text branches on the violation kind: prematureExit gets a Step-2-restart prompt, processViolation keeps the original "you researched but didn't record a thesis" prompt.
- If the discipline block is moved out of system-prompt.ts or the responseMessages fallback is removed, the regression returns. The coverage-retry gate (`expectedCoverage > 0 && preRetryThesisCount < expectedCoverage`) is also load-bearing for analysts with active theses; don't replace it with prematureExit alone.

**Never invent per-tool renderers** (`components/agent/renderers/`, `components/agent/ToolCallRow.tsx`)
- The renderer surface is exactly 5 files: `ToolUIRenderer` (the generic one) + 4 specialty (`ThesisCardRenderer`, `RunSummaryRenderer`, `ConfigPreviewRenderer`, `AskQuestionRenderer`). Every prior attempt to add a sixth (`TickerRenderer`, `TickerListRenderer`, `SourceRenderer`, `GenericRenderer`, `DecisionSummaryRenderer`, `MorningBriefRenderer`) was a thin wrapper that should have been a row shape inside `ToolUIRenderer`. All six have been deleted.
- The fix for "my tool's content doesn't show up" is never a new renderer. It is `data.items` with the right row kinds. See "Tool UI architecture" above.
- The fix for "my narrative paragraph doesn't have a ticker" is never to invent a fake ticker. It is `{ kind: "generic", text }`. The `$MARKET` fake-ticker bug lived for weeks because a prior session did this exact thing.
- This applies equally to **firehose pull tools** like `get_earnings_calendar` and `get_market_movers` — opening generic row + ticker rows in `data.items[]`, no `EarningsCalendarRenderer` / `MoversRenderer`. The cap-and-truncate "and N more" line is a `{ kind: "generic", text }` row, not a ticker.

**Position-thesis status desync** (`lib/agent/tools/place-trade.ts`, `lib/agent/tools/get-theses.ts`, `lib/agent/tools/get-portfolio-context.ts`)
- **What it looks like:** `get_portfolio_context` shows a position as OPEN; `get_theses` shows the same ticker as WATCHING. The agent reads both simultaneously and treats an already-held name as a watchlist candidate — narrates "Entry executed within max position size limits" in `reasoningSummary` while `status = WATCHING`.
- **Why it confuses the agent:** the agent's reasoning anchors on the prose `reasoningSummary` field over the structured `status` enum. It sees "Entry executed" → classifies as portfolio-held → ignores the WATCHING-thesis needsAction work → may re-evaluate an ENTER trigger on a position it already holds.
- **Root cause:** before PR #265, `place_trade` created the Position row but left the thesis in WATCHING status. Four production theses (AMD, AVGO, GOOGL, TSM) required a manual DB patch on 2026-05-13 (ThesisUpdate IDs prefixed `mfix`).
- **Fixed by PR #265** — `place_trade` now atomically flips WATCHING → HOLDING in the same DB transaction as the Alpaca order. No new trade can produce this desync.
- If you see a production thesis with `status=WATCHING` and a matching OPEN Position, it's a pre-PR-#265 row. Fix: `UPDATE "Thesis" SET status='HOLDING' WHERE id='...'` + write a manual ThesisUpdate STATUS_CHANGED row.

**V1/V2 prompt dispatch only honored in cron, not in route.ts** — ~~ACTIVE BUG~~ **RESOLVED 2026-05-16 (PR #270)**
- Historical context: `app/api/agent/[mode]/route.ts:232` always called the V1 prompt builder while `morning-research.ts` correctly read `config.useV2Prompt`. The UI "Run" button served the 600-line legacy prompt while the 8 AM cron used V2 — silent drift between the two surfaces.
- **Fix:** PR #270 deprecated the V1 builder (`buildV2SystemPrompt` — misnamed) and made route.ts call `buildDailyRunSystemPromptV2` unconditionally. The `useV2Prompt` flag is no longer read; column stays for migration cleanup.
- See `GAPS_HISTORY.md` → "Migrated from GAPS.md as part of this consolidation" → P0-11.

**Aggregates and the FEEDS dimension** (`lib/universe/feeds.ts`, `lib/inngest/functions/firm-market-sweep.ts`, `lib/inngest/functions/signal-router.ts`)
- Aggregate signals (`Signal.aggregateType` populated) carry empty `sectors`/`industries` by design — they're firm-wide. Routing them through the news-signal fence (sector/industry match) silently drops everything; that's the bug that #163/#164/#165/#166 chased.
- Right answer: aggregates match analysts via `feeds` membership (`analyst.feeds.includes(signal.aggregateType)`) — `feeds` is a peer Universe dimension, not a separate routing axis. Composition still applies: an analyst with `feeds:["EARNINGS_CALENDAR"]` + `industries:["Semiconductors"]` ends up with the calendar fenced to semis names by the existing AND-across-dimensions rule.
- Producers populate canonical FEEDS values verbatim (no mapping). When you add a new aggregate type, add the value to `lib/universe/feeds.ts`, have the producer write that exact string as `aggregateType`, and add a default-feeds entry to any matching strategy archetype in `lib/agent/knowledge/strategy-archetypes.ts`.
- The `aggregate-novelty-skip` carve-out from #164 is kept in place even though feed-subscription + ticker-intersection are now the correct primary gates. Reason: existing analysts with empty `feeds` still rely on the ticker-overlap path, and that path would get crushed by 7d route-history novelty without the carve-out. Safe to remove in a follow-up once every enabled analyst has a populated `feeds` array AND there's a deploy cycle of data confirming no regression.

- FMP historical-price-full may 403 on legacy plan (affects
  technical analysis for small-cap/ADR tickers)
- Old analysts created before V3 may need V3 infra backfill
  (source packs, intelligence queries, intelligence policy)
- read_signals returns 0 for analysts without routed signals
  (fallback queries by sector/watchlist exist but not verified)
- Morning brief tool UI shows counts but not full briefing content

(Most other items previously here are now tracked in
`docs/GAPS.md` (active thesis-architecture work) or
`docs/TECH_DEBT.md` (orthogonal fragility). When you spot something
new, file it there — not here.)

## Active multi-PR plans
- **`docs/plans/legacy/MORNING_RUN_V2_DESIGN.md`** — Daily-run prompt rewrite + `needsAction` tool field + mode allowlist locking. All 7 fixes shipped 2026-05-13; archived as build history. The live thesis reference is `docs/THESIS_ARCHITECTURE.md`.
- **`docs/THESIS_ARCHITECTURE.md`** — **The live reference for the thesis system.** Read this before touching anything thesis-related. Documents the end-to-end lifecycle (state machine + 9 canonical scenarios), legal `(direction, status)` pairs, producers + gates, consumers, and the 5-bucket run-summary derivation.

### Recently closed
- **Watchlist collapse (2026-05-13)** — `AnalystWatchlistItem` deleted, `manage_watchlist` deleted, `Thesis` is now the single watchlist store. `direction=null` for seeds awaiting first research; terminal-without-trade is `PASSED` (researched-decline) or `RETIRED` (dropped watch). See `docs/THESIS_ARCHITECTURE.md` for the post-collapse model.

## Key Files
### Agent System
- lib/agent/tools/ — 18 individual tool files, each using defineTool()
- lib/agent/tools/index.ts — single export + createResearchTools() wrapper
- lib/agent/define-tool.ts — defineTool() factory with timing/logging
- lib/universe/feeds.ts — canonical FEEDS enum + normalizeFeeds (mirrors Signal.aggregateType)
- lib/agent/tools/get-earnings-calendar.ts — pull-tool counterpart to EARNINGS_CALENDAR feed
- lib/agent/tools/get-market-movers.ts — pull-tool counterpart to MARKET_MOVERS_* feeds
- lib/agent/tool-result.ts — ToolResult<T> discriminated union + normalizer
- lib/agent/tool-context.ts — ToolContext interface + createToolContext()
- lib/agent/modes.ts — model, provider, thinking budget, tool allowlists
- lib/agent/system-prompt.ts — agent persona + instructions
- components/research/AgentThread.tsx — live agent UI
- components/agent/ToolCallGroup.tsx — groups tool calls by groupId
- components/agent/ToolCallRow.tsx — dispatches on result.ui to renderers
- components/agent/renderers/ — one renderer per ui discriminator
- components/agent/sheets/ThesisSheet.tsx — ThesisSheetBody + ThesisSheet
- app/api/agent/[mode]/route.ts — unified route (research-run/builder/editor)
- app/api/research/agent-run/route.ts — creates ResearchRun row

### Triggers (the living ladder)
- lib/agent/triggers/types.ts — predicate union (incl. GAIN_FROM_ENTRY + TRAILING_FROM_HIGH) + isDirectEligiblePredicate + protectiveExitCloseReason
- lib/agent/triggers/evaluate.ts — pure evaluator (1D daily-move + HOLDING-only gain/trail paths)
- lib/agent/triggers/defaults.ts — horizon templates + standingProtectionTriggers() (+10%/8%/−12%) + scaleInOn* (±7%) + cooldown defaults
- lib/inngest/functions/trigger-evaluator.ts — 5-min cron + signal paths
- lib/inngest/functions/tactical-run.ts — TACTICAL agent / DIRECT close consumer
- lib/actions/thesis-edit.ts — UI add / edit / delete / fire-mode write paths
- Mechanics: docs/TRIGGERS.md · model: docs/plans/TRIGGER_MODEL.md · lifecycle: docs/plans/TRIGGER_LIFECYCLE.md · why: docs/plans/THESIS_GAME_PLAN.md

### Run Pages
- app/(root)/runs/[id]/page.tsx — run detail (AgentThread vs
  RunUnifiedChat based on mode/status)
- components/research/RunUnifiedChat.tsx — events→chat renderer
- components/research/RunFollowupChat.tsx — post-run chat

### Analyst System
- components/analysts/AnalystBuilderChat.tsx — AI creation chat
- components/analysts/AnalystEditorChat.tsx — AI editing chat
- components/analysts/AnalystChatProvider.tsx — routes to /api/agent/builder
  or /api/agent/editor
- components/analysts/AnalystDetailClient.tsx — analyst detail 2-col

### Intelligence Pipeline
- lib/intelligence/sonar.ts — Perplexity Sonar API client
- lib/intelligence/firecrawl.ts — Firecrawl extraction client
- lib/intelligence/signals.ts — signal creation + dedup utilities
- lib/intelligence/types.ts — intelligence type definitions
- lib/inngest/functions/firm-market-sweep.ts — daily sweep
- lib/inngest/functions/portfolio-watchlist-monitor.ts — ticker monitor
- lib/inngest/functions/domain-monitor.ts — domain monitor
- lib/inngest/functions/signal-router.ts — signal routing
- lib/inngest/functions/morning-brief-generator.ts — brief generation

### Inngest Crons
- lib/inngest/functions/morning-research.ts — daily agent run
- lib/inngest/functions/price-monitor.ts — hourly price check
- lib/inngest/functions/trade-evaluator.ts — post-trade GPT-4o eval
- lib/inngest/functions/eod-evaluation.ts — end-of-day snapshots
- lib/inngest/functions/accuracy-scorer.ts — weekly accuracy

### Core Lib
- lib/alpaca.ts — Alpaca paper trading client
- lib/trade-exit.ts — exit strategy evaluation
- lib/market-hours.ts — isMarketOpen() with ET + holidays
- lib/prisma.ts — Prisma client (adapter-pg)

## Repo
https://github.com/dave-sucks/hindsight
