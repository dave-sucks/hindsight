// ── Workflow Registry ──────────────────────────────────────────────────────
// Single source of truth for Hindsight's operational flow.
// 5 teams, each with sub-steps and tools. Powers both the /agent-workflow
// page (full flow) and each page's HowItWorksSheet (single team).

import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  Radar,
  Search,
  BarChart3,
  RotateCcw,
  Bot,
  Newspaper,
  Globe,
  Target,
  ShoppingCart,
  Eye,
  CheckCircle2,
  Brain,
  FileText,
  Clock,
  Wrench,
  LineChart,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export type ResourceType = "api" | "website" | "db" | "internal";

export interface Resource {
  /** Provider key for icon */
  source: string;
  title: string;
  description: string;
  type: ResourceType;
  /** Endpoint path, function name, or URL */
  endpointOrPath: string;
  /** Human-readable example output */
  exampleOutput?: string;
  notes?: string[];
}

export interface ToolEntry {
  /** Machine name (e.g. "get_stock_data") or display name (e.g. "Perplexity Sonar") */
  name: string;
  /** Provider key for icon badge */
  provider: string;
  /** One sentence */
  summary: string;
  /** Optional detailed resources — powers the tool detail dialog */
  resources?: Resource[];
}

export interface SubStep {
  title: string;
  /** One sentence */
  summary: string;
  /** Optional time label (e.g. "6:30 AM") */
  time?: string;
}

export type TeamId =
  | "builder"
  | "editor"
  | "intelligence"
  | "agent"
  | "briefing"
  | "evaluation";

export interface Team {
  id: TeamId;
  title: string;
  /** 1-2 sentences — shown on workflow page rows */
  summary: string;
  /** 3-5 sentences — shown in the sheet */
  description: string;
  icon: LucideIcon;
  /** Model used, if any */
  model?: string;
  /** When this team runs */
  schedule: string;
  substeps: SubStep[];
  tools: ToolEntry[];
  /** If this team has a system prompt, lazy-load it */
  getPrompt?: () => Promise<string>;
  /** Source file for the prompt (shown as reference if getPrompt is not available) */
  promptSource?: string;
}

// ── Shared tools (referenced by multiple teams) ──────────────────────────

const TOOL_GET_MARKET_CONTEXT: ToolEntry = {
  name: "get_market_context", provider: "finnhub", summary: "SPY, VIX, sector ETFs, macro events, regime classification.",
  resources: [
    { source: "finnhub", title: "Index & sector quotes", description: "SPY, VIX, and 11 sector ETFs in a single batch.", type: "api", endpointOrPath: "/quote?symbol=SPY,^VIX,XLK,...", exampleOutput: "SPY $542.31 +0.8% · VIX 14.2 · XLK +1.2% (leading)" },
    { source: "finnhub", title: "Broad market trend", description: "30 days of SPY candles to determine uptrend/downtrend.", type: "api", endpointOrPath: "/stock/candle?symbol=SPY&resolution=D", exampleOutput: "SPY above SMA-20 ($538.50) → uptrend" },
    { source: "finnhub", title: "Earnings density", description: "How many companies report this week.", type: "api", endpointOrPath: "/calendar/earnings", exampleOutput: "47 companies reporting — elevated density" },
    { source: "fmp", title: "Economic calendar", description: "Major macro events today — Fed, CPI, jobs.", type: "api", endpointOrPath: "/economic_calendar", exampleOutput: "CPI release 8:30 AM (high impact)" },
  ],
};

const TOOL_GET_STOCK_DATA: ToolEntry = {
  name: "get_stock_data", provider: "finnhub", summary: "Price, profile, financials, technicals, consensus, news for one ticker.",
  resources: [
    { source: "finnhub", title: "Live price", description: "Current price, change, and day range.", type: "api", endpointOrPath: "/quote?symbol={ticker}", exampleOutput: "NVDA $134.23 +2.1%" },
    { source: "finnhub", title: "Company profile", description: "Name, sector, market cap, exchange.", type: "api", endpointOrPath: "/stock/profile2?symbol={ticker}", exampleOutput: "NVIDIA Corp · Technology · $3.3T" },
    { source: "finnhub", title: "Key financials", description: "P/E, P/B, beta, 52W range, EPS.", type: "api", endpointOrPath: "/stock/metric?symbol={ticker}&metric=all", exampleOutput: "P/E 65.2 · Beta 1.68 · 52W $75–$153" },
    { source: "finnhub", title: "Recent headlines", description: "5 most recent news articles.", type: "api", endpointOrPath: "/company-news?symbol={ticker}", exampleOutput: "\"NVIDIA Announces Blackwell GPUs\" — Reuters" },
    { source: "finnhub", title: "Wall Street consensus", description: "Buy/Hold/Sell analyst ratings.", type: "api", endpointOrPath: "/stock/recommendation?symbol={ticker}", exampleOutput: "Strong Buy: 38 · Buy: 6 · Hold: 3" },
    { source: "finnhub", title: "Technical setup", description: "RSI, SMAs, volume, 52W position, trend.", type: "api", endpointOrPath: "/stock/candle?symbol={ticker}&resolution=D", exampleOutput: "RSI 58 · Above SMA-20 · Volume 1.3x avg", notes: ["60 days of daily data", "Falls back to FMP/Alpaca"] },
    { source: "fmp", title: "Price targets", description: "Wall Street average/high/low targets.", type: "api", endpointOrPath: "/v4/price-target-consensus?symbol={ticker}", exampleOutput: "Avg $158 · High $200 · Low $120 · 44 analysts" },
  ],
};

const TOOL_GET_EARNINGS_DATA: ToolEntry = {
  name: "get_earnings_data", provider: "finnhub", summary: "Next report date, EPS estimates, beat rate track record.",
  resources: [
    { source: "finnhub", title: "Next report date", description: "When, before/after market, EPS/rev estimates.", type: "api", endpointOrPath: "/calendar/earnings?symbol={ticker}", exampleOutput: "Reports Mar 26 AMC · EPS est $0.84" },
    { source: "finnhub", title: "Track record", description: "Last 8 quarters actual vs expected.", type: "api", endpointOrPath: "/stock/earnings?symbol={ticker}&limit=8", exampleOutput: "Beat rate 87.5% (7/8) · Last Q +5.9%" },
  ],
};

const TOOL_GET_SEC_FILINGS: ToolEntry = {
  name: "get_sec_filings", provider: "sec", summary: "Recent SEC filings — 10-K, 10-Q, 8-K, Form 4.",
  resources: [
    { source: "sec", title: "Company lookup", description: "Finds SEC CIK identifier.", type: "api", endpointOrPath: "sec.gov/files/company_tickers.json", exampleOutput: "NVDA → CIK 0001045810" },
    { source: "sec", title: "Recent filings", description: "Last 8 filings — annuals, quarterlies, material events, insider trades.", type: "api", endpointOrPath: "data.sec.gov/submissions/CIK{cik}.json", exampleOutput: "8-K Mar 15 · Form 4 — insider sale 50K shares" },
  ],
};

// ── Teams ──────────────────────────────────────────────────────────────────

export const TEAMS: Team[] = [
  // ─── 1. Analyst Builder ────────────────────────────────────────────────
  {
    id: "builder",
    title: "Analyst Builder",
    summary:
      "Creates new analyst personas through a structured interview. Grounds every proposal in the knowledge library and real signal discovery before writing the config.",
    description:
      "You describe the edge you want to hunt in conversation. The builder (GPT-4o, 25-step budget) runs a structured interview with ask_question — opening the conversation, narrowing with two or three follow-ups, then grounding in the knowledge library (strategy archetypes / playbooks, vetted sources, signal taxonomy). Before it writes anything, it validates the proposed universe against reality by calling discover_signals_for_fence and pulling real market context. It then emits a complete analyst config through suggest_config — name, 3-5 paragraph analystPrompt adapted from a playbook skeleton, universe (sectors + industries + themes + marketCap), direction bias, hold durations, confidence threshold, position sizing, watchlist seeded from the fence discovery (never hallucinated), exclusion list, intelligence policy (attention weights + live search budget), plus 4-6 proposed domain monitors and 3-5 intelligence queries. The config appears as a side-panel diff for review; builder validation rejects contradictions like watchlist tickers outside the market-cap fence before you ever see them.",
    icon: Sparkles,
    model: "GPT-4o",
    schedule: "On demand",
    substeps: [
      { title: "Opening question", summary: "ask_question with 2-5 quick-reply options — what edge are you hunting? (earnings surprises, momentum, value, catalyst, thematic)" },
      { title: "Narrow the strategy", summary: "2-3 follow-up questions via ask_question: direction bias, hold duration, risk appetite, themes if thematic." },
      { title: "Ground in the knowledge library", summary: "Browses strategy archetypes (playbooks), offers 3-4 as quick replies, then deep-reads the chosen skeleton plus signal taxonomy and source catalog." },
      { title: "Validate with real data", summary: "get_market_context for regime, discover_signals_for_fence to confirm the proposed universe actually produces signals. 0 hits = widen the fence." },
      { title: "Propose monitors", summary: "Selects 4-6 real domains from the source catalog and drafts 3-5 discovery queries (no per-ticker feeds)." },
      { title: "Emit config", summary: "suggest_config returns the full analyst as a side-panel diff. Watchlist seeded from fence discovery, never hallucinated. Validation blocks cap/watchlist contradictions before display." },
    ],
    tools: [
      { name: "ask_question", provider: "internal", summary: "Structured interview with 2-5 quick-reply options. Mandatory before suggest_config." },
      { name: "read_knowledge_library", provider: "internal", summary: "Browses strategy archetypes (playbooks), vetted research sources, and signal-type taxonomy." },
      { name: "discover_signals_for_fence", provider: "internal", summary: "Runs a live query against real signals matching the proposed universe (sectors + industries + themes + tickers). Returns frequency-ranked tickers for watchlist seeding." },
      TOOL_GET_MARKET_CONTEXT,
      TOOL_GET_STOCK_DATA,
      TOOL_GET_EARNINGS_DATA,
      TOOL_GET_SEC_FILINGS,
      { name: "web_search", provider: "perplexity", summary: "Live Sonar search for verification questions during the interview." },
      { name: "suggest_config", provider: "internal", summary: "Emits the complete analyst config for side-panel review. Validated: watchlist must fit inside the market-cap fence; industries auto-filled from sectors if missing." },
    ],
    getPrompt: () => import("@/lib/agent/builder-prompt-template").then((m) => m.BUILDER_PROMPT_TEMPLATE),
    promptSource: "lib/agent/modes.ts → BUILDER_SYSTEM_PROMPT",
  },

  // ─── 1b. Analyst Editor ────────────────────────────────────────────────
  {
    id: "editor",
    title: "Analyst Editor",
    summary:
      "Edits existing analysts via a 4-lane flow. Classifies the request first, keeps the analyst prompt frozen for pure numeric tweaks, and grounds fence changes in real inbox data.",
    description:
      "The editor (GPT-4o, 20-step budget) is not a second builder. The first thing it does — silently — is classify the request into one of four lanes and behave differently for each. Lane (a) Q&A only: answers from currentConfig, no suggest_config. Lane (b) numeric-only tweaks (minConfidence, maxPositionSize, maxOpenPositions, holdDurations, marketCapMin/Max, directionBias, intelligencePolicy): the analystPrompt stays FROZEN character-for-character. Lane (c) fence change (sectors / industries / themes / watchlist / exclusionList): starts with read_analyst_inbox_stats to ground in 30 days of real routing data, validates the new fence with discover_signals_for_fence (must produce routes), consults the current playbook skeleton, then weaves ONE short fence-change paragraph into the existing analystPrompt — the rest stays intact. Lane (d) archetype/strategy shift: full three-beat playbook selection (browse → ask_question → deep-read), full analystPrompt rewrite grounded in the new skeleton while preserving risk/exit discipline that was working. Throughout: one ask_question per turn, no markdown headings, no citation markers, sectors + industries always proposed together.",
    icon: Wrench,
    model: "GPT-4o",
    schedule: "On demand",
    substeps: [
      { title: "Classify the request", summary: "Silent lane decision: (a) Q&A, (b) numeric tweak, (c) fence change, (d) archetype shift. Determines whether analystPrompt is frozen or rewritten." },
      { title: "Ground in real experience", summary: "Lanes (c) and (d): read_analyst_inbox_stats pulls 30 days of routing data — top tickers hit, dead themes, hot unwatched tickers, signal-type distribution." },
      { title: "Pin down ambiguity", summary: "One ask_question per turn with 2-5 options. 'More aggressive' resolves to one of: minConfidence, maxPositionSize, maxOpenPositions, signal type." },
      { title: "Validate fence changes", summary: "discover_signals_for_fence with the PROPOSED fence. 0 signals = push back with evidence before suggesting." },
      { title: "Consult playbooks", summary: "Lane (c): reread current archetype skeleton. Lane (d): three-beat selection — browse → ask_question → deep-read." },
      { title: "Emit suggest_config", summary: "Lane (b): analystPrompt unchanged. Lane (c): one fence paragraph woven in. Lane (d): analystPrompt rewritten from the new skeleton. Sectors + industries always together." },
    ],
    tools: [
      { name: "ask_question", provider: "internal", summary: "Structured interview with 2-5 quick-reply options. One per turn." },
      { name: "read_analyst_inbox_stats", provider: "internal", summary: "30-day rollup of this analyst's routing: top tickers, sectors, themes, dead themes, signal distribution, hot unwatched tickers. Mandatory for fence/archetype changes." },
      { name: "read_knowledge_library", provider: "internal", summary: "Strategy archetypes, vetted sources, signal-type taxonomy." },
      { name: "discover_signals_for_fence", provider: "internal", summary: "Validates the proposed fence against real signals. No routes = fence too narrow." },
      TOOL_GET_MARKET_CONTEXT,
      TOOL_GET_STOCK_DATA,
      TOOL_GET_EARNINGS_DATA,
      { name: "web_search", provider: "perplexity", summary: "Live Sonar search for verification questions." },
      { name: "suggest_config", provider: "internal", summary: "Emits the updated analyst as a side-panel diff. Lane-aware: numeric-only never touches analystPrompt; fence changes preserve the rest of the document." },
    ],
    getPrompt: () => import("@/lib/agent/builder-prompt-template").then((m) => m.BUILDER_PROMPT_TEMPLATE),
    promptSource: "lib/agent/modes.ts → EDITOR_SYSTEM_PROMPT",
  },

  // ─── 2. Intelligence Pipeline ──────────────────────────────────────────
  {
    id: "intelligence",
    title: "Intelligence Pipeline",
    summary:
      "Five background jobs run every weekday morning. Gathers market news, email newsletters, and tracked sources; routes findings to each analyst's universe; writes grounded morning briefs.",
    description:
      "Before analysts wake up, 5 background jobs gather market intelligence. Search monitors run custom queries via Perplexity Sonar. Portfolio/watchlist monitors check every open position and watchlist item (per-ticker searches with forced ticker injection). Domain monitors check tracked websites and extract full articles via Firecrawl. Inbound newsletters arrive via Resend and are extracted into signals by GPT-4o-mini. The signal router evaluates each signal against every analyst's universe fence (sectors + industries + themes + market-cap, plus hard watchlist/position bypass) and tags each route with a reason code: POSITION, WATCHLIST, DIRECT_TICKER, SECTOR_MATCH, INDUSTRY_MATCH, THEME_MATCH, DISCOVERY, or CROSS_ANALYST. Relevance is scored (position +50, watchlist +45, industry +22, sector +20, theme +18, breaking +15, high +10) then multiplied by a 7-day novelty score so stale names get crushed (HIGH/BREAKING urgency gets a carve-out). A per-analyst cap reserves 20% of slots for DISCOVERY so new names can't be squeezed out. Finally, GPT-4o synthesizes each analyst's routed findings into a structured morning brief — grounded to today's routes only (signalIds are validated against the day's pool; holdings-attention forces one alert per open position; at least one real discovery is required when the bucket is non-empty).",
    icon: Radar,
    schedule: "6:30–7:45 AM ET weekdays",
    substeps: [
      { title: "Firm market sweep", time: "6:30 AM", summary: "Runs firm-wide search queries via Perplexity Sonar. Fetches FMP movers (gainers/losers/actives) and Finnhub earnings calendar. All signals normalized through canonical GICS sectors/industries." },
      { title: "Portfolio & watchlist monitor", time: "7:00 AM", summary: "Per-analyst Sonar searches on every open position and watchlist ticker, with forced ticker injection so the result is guaranteed to tag the target symbol." },
      { title: "Domain monitors", time: "7:15 AM", summary: "Checks tracked websites via domain-filtered Sonar. Firecrawl extracts full articles into Artifact rows for high-priority sources so the agent can read the whole page later." },
      { title: "Email ingest", time: "on receipt", summary: "Resend inbound webhook delivers newsletter emails. GPT-4o-mini extracts one signal per distinct investable idea with tickers, themes, urgency, and sentiment." },
      { title: "Signal router", time: "7:30 AM", summary: "Per signal × analyst: checks universe fence (sectors + industries + themes + marketCap, AND across dimensions, OR within). Watchlist + open positions bypass fence. Tags route with a reason code, scores relevance, multiplies by novelty, reserves 20% of slots for DISCOVERY." },
      { title: "Morning brief", time: "7:45 AM", summary: "GPT-4o synthesizes today's routes (not yesterday's) into market context, portfolio alerts, watchlist updates, new opportunities, attention priority, and risk flags. Every cited signalId is validated against the day's route pool; hallucinations trigger retry." },
    ],
    tools: [
      {
        name: "Perplexity Sonar", provider: "perplexity", summary: "Real-time web search for news, analysis, and press releases.",
        resources: [
          { source: "perplexity", title: "Web search", description: "Domain-filtered or open web search via Sonar API.", type: "api", endpointOrPath: "searchSignals(query, { recency: 'day' })", exampleOutput: "5 results · sentiment: bullish · urgency: MEDIUM", notes: ["Returns up to 10 structured signals per search"] },
        ],
      },
      {
        name: "Firecrawl", provider: "firecrawl", summary: "Full-page article extraction from URLs found by Sonar.",
        resources: [
          { source: "firecrawl", title: "Page extraction", description: "Extracts full article as clean markdown.", type: "website", endpointOrPath: "extractPage(url)", exampleOutput: "2500 words extracted from Reuters article", notes: ["Stored as Artifact record with content hash dedup"] },
        ],
      },
      {
        name: "FMP Market Movers", provider: "fmp", summary: "Top gainers, losers, and most active stocks.",
        resources: [
          { source: "fmp", title: "Gainers", description: "Top 10 stocks by % gain today.", type: "api", endpointOrPath: "/stock_market/gainers", exampleOutput: "SMCI +12.3%, PLTR +8.1%, ..." },
          { source: "fmp", title: "Losers", description: "Top 10 stocks by % loss today.", type: "api", endpointOrPath: "/stock_market/losers" },
          { source: "fmp", title: "Most active", description: "Top 10 by volume today.", type: "api", endpointOrPath: "/stock_market/actives" },
        ],
      },
      {
        name: "Finnhub Earnings", provider: "finnhub", summary: "Earnings calendar for the next 7 days.",
        resources: [
          { source: "finnhub", title: "Earnings calendar", description: "Companies reporting in the next 7 days.", type: "api", endpointOrPath: "/calendar/earnings?from={today}&to={+7d}", exampleOutput: "NVDA Mar 26, AAPL Mar 28, ..." },
        ],
      },
      { name: "GPT-4o Brief Gen", provider: "internal", summary: "Synthesizes routed findings into structured analyst briefs." },
    ],
  },

  // ─── 3. Research Agent ─────────────────────────────────────────────────
  {
    id: "agent",
    title: "Research Agent",
    summary:
      "Runs structured research sessions in six stages: orient, research, theses, act, recap, complete. Reads intelligence, validates with live data, writes theses with signal provenance, manages positions, and executes paper trades.",
    description:
      "Each analyst runs as a GPT-4o agent (temperature 0.2, 50-step budget). Before the first tool call, the system loads full context into the prompt: identity + operating manual (the analyst's 3-5 paragraph playbook), trading rules (direction bias, hold durations, minConfidence, maxPositionSize, maxOpenPositions, exclusions), the universe fence (sectors + industries + themes + marketCap), intelligence policy (attention weights + live-search budget), the current portfolio with live P&L and thesis summaries, priority reviews flagged by the price monitor (NEAR_TARGET / NEAR_STOP — must-research), active LONG/SHORT theses, the watchlist with priorities, yesterday's briefing (watch-tomorrow, unresolved items, self-corrections), performance stats (win rate, signal-type accuracy, calibration), and recent closed trades. The agent then follows a strict 6-stage flow with tool-call floors at each stage boundary; stage headers in the prompt (### Stage N — NAME) are structural, not decorative. Every record_thesis must declare source_kind (ROUTED_SIGNAL, WEB_SEARCH, WATCHLIST_REVIEW, POSITION_REVIEW) and pass source_signal_ids when citing signals — this is what powers signal→thesis→monitor traceability. complete_run is blocked until a thesis exists for every researched ticker.",
    icon: Bot,
    model: "GPT-4o",
    schedule: "8:00 AM ET weekdays + on demand",
    substeps: [
      { title: "Portfolio check-in", summary: "Acknowledges open positions and watchlist items, references prior brief's watch-tomorrow triggers and priority reviews. Plain text — no tools." },
      { title: "Stage 1 — Orient", summary: "read_morning_brief, read_signals (returns three buckets: portfolio / watchlist / discovery, each with signalId for provenance), read_artifact on any signal worth a deep read. web_search only for niche verification within budget." },
      { title: "Stage 2 — Research", summary: "get_portfolio_context first (live P&L, days held, distance from peak, original thesis). Then get_stock_data on every holding, every priority review, watchlist HIGH/flagged items, and ≥2 discovery candidates not already in portfolio or watchlist." },
      { title: "Stage 3 — Theses", summary: "record_thesis for every researched ticker (LONG / SHORT / PASS). source_kind is mandatory; source_signal_ids required for ROUTED_SIGNAL, source_rationale required otherwise. Prior theses on the same ticker auto-supersede. Signal IDs flip their AnalystSignalRoute status to ACTED_ON in the same transaction." },
      { title: "Stage 4 — Act", summary: "Per-position discipline: close_position or manage_position (partial_close, update_targets, move_stop_to_breakeven, set_trailing_stop, add_to_position) for every existing holding, or explicit 'hold unchanged' narration. Then place_trade for new entries. Then manage_watchlist for adds/removes." },
      { title: "Stage 5 — Recap", summary: "record_run_summary with ranked_picks (every researched ticker + the action that actually happened) and exposure breakdown." },
      { title: "Stage 6 — Complete", summary: "complete_run with no arguments. Marks the run COMPLETE and inlines the briefing agent which writes tomorrow's standup. Blocked until every researched ticker has a thesis." },
    ],
    tools: [
      // Intelligence (Stage 1)
      { name: "read_morning_brief", provider: "internal", summary: "Pre-generated intelligence brief with market context, alerts, and opportunities — grounded to today's routes only." },
      { name: "read_signals", provider: "internal", summary: "Routed signals in three buckets: portfolioSignals, watchlistSignals, discoverySignals. Every signal carries signalId for thesis provenance. Reading flips route status PENDING → READ." },
      { name: "read_artifact", provider: "internal", summary: "Full extracted article content (clean markdown from Firecrawl) behind a signal. Agent passes artifactId from the signal record." },
      { name: "web_search", provider: "perplexity", summary: "Live Perplexity Sonar search for breaking news or niche topics. Respects intelligencePolicy.allowLiveSearch and liveSearchBudget.",
        resources: [{ source: "perplexity", title: "Sonar web search", description: "Real-time web search with recency filtering.", type: "api", endpointOrPath: "searchSignals(query, { recency })", exampleOutput: "5 results · sentiment: bullish · urgency: MEDIUM", notes: ["Per-run budget from analyst's intelligencePolicy"] }],
      },
      TOOL_GET_MARKET_CONTEXT,
      // Research (Stage 2)
      { name: "get_portfolio_context", provider: "internal", summary: "Live portfolio snapshot: P&L %, days held, distance from peak price, exit levels, original thesis reasoning. Called at start of every research stage." },
      TOOL_GET_STOCK_DATA,
      {
        name: "get_options_flow", provider: "fmp", summary: "Put/call ratio, unusual contracts, institutional positioning.",
        resources: [{ source: "fmp", title: "Options chain analysis", description: "P/C ratio, unusual volume/OI contracts, premium flags.", type: "api", endpointOrPath: "/options/chain/{ticker}", exampleOutput: "P/C 0.65 (bullish) · 3 unusual contracts", notes: ["Flags vol/OI ≥ 5x or premium ≥ $500K"] }],
      },
      TOOL_GET_EARNINGS_DATA,
      TOOL_GET_SEC_FILINGS,
      // Decision (Stage 3)
      { name: "record_thesis", provider: "internal", summary: "Records LONG/SHORT/PASS verdict with confidence, targets, bullets, risk flags. Requires source_kind (ROUTED_SIGNAL | WEB_SEARCH | WATCHLIST_REVIEW | POSITION_REVIEW); ROUTED_SIGNAL requires source_signal_ids (validated against today's routed pool). Flips cited routes to ACTED_ON. Auto-supersedes prior theses on the same ticker." },
      // Execution (Stage 4)
      {
        name: "place_trade", provider: "alpaca", summary: "Places a paper market order on Alpaca. Waits for fill.",
        resources: [
          { source: "alpaca", title: "Submit order", description: "Market buy/sell at current price.", type: "api", endpointOrPath: "placeMarketOrder({ symbol, qty, side })", exampleOutput: "BUY 74 shares NVDA @ $134.23" },
          { source: "alpaca", title: "Confirm fill", description: "Waits up to 5s for fill confirmation.", type: "api", endpointOrPath: "getOrder(orderId)", exampleOutput: "FILLED · Avg $134.23" },
          { source: "internal", title: "Record position", description: "Saves position, logs trade decision, graduates watchlist items.", type: "db", endpointOrPath: "prisma.position.create()", notes: ["Blocks duplicate positions in same ticker"] },
        ],
      },
      {
        name: "close_position", provider: "alpaca", summary: "Closes a full position with exit reason and realized P&L. Use manage_position for partial exits or target/stop updates.",
        resources: [
          { source: "alpaca", title: "Sell all shares", description: "Closes the full position.", type: "api", endpointOrPath: "closeOpenPosition(symbol)", exampleOutput: "Closed 50 AAPL @ $192.40 · +$710 (+7.9%)" },
          { source: "internal", title: "Record outcome", description: "Marks position closed with P&L and reason.", type: "db", endpointOrPath: "prisma.position.update({ CLOSED })", exampleOutput: "EXIT: TARGET · WIN · +$710" },
        ],
      },
      { name: "manage_position", provider: "alpaca", summary: "Nuanced position management: partial_close, update_targets, move_stop_to_breakeven, set_trailing_stop, add_to_position. Every action is audit-logged with a required reason string." },
      { name: "manage_watchlist", provider: "internal", summary: "Adds/updates/removes watchlist items with priority and catalysts. Narrated watchlist updates without a tool call are a run failure." },
      // Run lifecycle (Stages 5–6)
      { name: "record_run_summary", provider: "internal", summary: "Structured per-ticker recap: ranked picks + exposure breakdown. Pure data." },
      { name: "complete_run", provider: "internal", summary: "No-args. Marks the run complete in the DB and triggers the briefing agent. Always the agent's final tool call." },
    ],
    getPrompt: () => import("@/lib/agent/system-prompt-template").then((m) => m.SYSTEM_PROMPT_TEMPLATE),
    promptSource: "lib/agent/system-prompt-template.ts",
  },

  // ─── 4. Briefing Agent ─────────────────────────────────────────────────
  {
    id: "briefing",
    title: "Briefing Agent",
    summary:
      "When the research agent calls complete_run, a GPT-4o reviewer generates a standup memo inline — the analyst's memory for the next run.",
    description:
      "Called directly by the complete_run tool at the end of every research session. When the research agent finishes its work and calls complete_run, that tool marks the run COMPLETE and then immediately calls the briefing agent inline — no events, no queues. A GPT-4o agent reads the full conversation transcript, portfolio state, and trade outcomes. It writes a structured standup: narrative (400-600 words), strategy notes, market posture, watch-tomorrow items, unresolved items, self-corrections, and 0-5 dynamic search monitors. The standup feeds into the next session's system prompt. The analyst references watch-tomorrow items in their portfolio check-in before Stage 1. Dynamic monitors are picked up by the next morning's intelligence sweep automatically.",
    icon: RotateCcw,
    model: "GPT-4o",
    schedule: "After every run",
    substeps: [
      { title: "Mark complete", summary: "complete_run tool marks the run COMPLETE, then immediately calls the briefing agent inline. No events or queues." },
      { title: "Read transcript", summary: "Reads the full conversation — every message, tool call, and result from the session." },
      { title: "Review portfolio", summary: "Checks current positions with unrealized P&L, trade outcomes, and pass decisions." },
      { title: "Write standup", summary: "Produces narrative, strategy notes, market posture, watch-tomorrow items, and self-corrections." },
      { title: "Create monitors", summary: "Generates 0-5 temporary search monitors with expiration dates for next morning's sweep." },
    ],
    tools: [
      { name: "Conversation transcript", provider: "internal", summary: "Full research session messages, tool calls, and results (~12k chars).",
        resources: [{ source: "internal", title: "Run messages", description: "Complete conversation persisted to RunMessage table.", type: "db", endpointOrPath: "prisma.runMessage.findMany({ runId })", exampleOutput: "47 messages · 12 tool calls · 28k tokens" }],
      },
      { name: "Portfolio state", provider: "internal", summary: "Open positions, unrealized P&L, capital deployed, win rate.",
        resources: [{ source: "internal", title: "Portfolio snapshot", description: "Current positions with live P&L and exposure breakdown.", type: "db", endpointOrPath: "prisma.position.findMany({ status: OPEN })", exampleOutput: "3 positions · $9,870 deployed · 65% win rate" }],
      },
      { name: "GPT-4o Reviewer", provider: "internal", summary: "Writes an external review — not self-reported by the research agent.",
        resources: [{ source: "internal", title: "Standup generation", description: "Structured output: narrative, strategy notes, posture, watch items, corrections, dynamic monitors.", type: "internal", endpointOrPath: "generateObject({ schema: standupSchema })", exampleOutput: "Narrative: 450 words · 3 watch items · 1 dynamic monitor" }],
      },
    ],
    getPrompt: () => import("@/lib/agent/briefing-prompt-template").then((m) => m.BRIEFING_PROMPT_TEMPLATE),
    promptSource: "lib/agent/update-analyst-briefing.ts",
  },

  // ─── 5. Evaluation ─────────────────────────────────────────────────────
  {
    id: "evaluation",
    title: "Evaluation & Tracking",
    summary:
      "Background jobs that monitor positions hourly, evaluate closed trades, walk the signal→thesis→monitor chain for ROI, snapshot EOD prices, and score accuracy weekly. /intelligence (Health tab) surfaces pipeline drift.",
    description:
      "Five background jobs track analyst performance and pipeline health. The price monitor checks all open positions hourly via Alpaca and flags positions near target (80%) or stop-loss. When a position closes, the trade evaluator does two things: (1) GPT-4o reviews the trade and writes a lesson, and (2) it walks the provenance chain — Thesis.sourceSignalIds → Signal → Monitor — and credits each source Monitor's tradesSourced / winsSourced / lossesSourced counters, then recomputes successScore = (wins − losses) / trades. This is what turns the intelligence pipeline into a self-improving system: monitors that keep producing losing theses drift toward negative ROI, and the /intelligence (Health tab) page surfaces it. The EOD snapshot at 5 PM captures closing prices. The Sunday scorer calculates win rate, confidence calibration, and per-sector performance, all injected into the next run's prompt. The Health page layers observability on top: dead crons, signal funnel (routed → read → cited), ticker concentration, novelty histogram, and monitor ROI.",
    icon: BarChart3,
    schedule: "Hourly / EOD / Weekly + on every close",
    substeps: [
      { title: "Price monitor", time: "Hourly", summary: "Checks all open positions via Alpaca. Flags positions near target (80%) or stop-loss; auto-closes hard stops." },
      { title: "Trade evaluator", time: "On close", summary: "GPT-4o reviews each closed trade. Then walks Thesis.sourceSignalIds → Monitor and updates tradesSourced / winsSourced / lossesSourced / successScore." },
      { title: "EOD snapshot", time: "5 PM ET", summary: "Captures closing prices for all positions. Builds the equity curve." },
      { title: "Accuracy scorer", time: "Sunday 10 AM", summary: "Calculates win rate, confidence calibration buckets, and per-sector / per-signal-type performance." },
      { title: "Health dashboard", time: "On demand", summary: "/intelligence (Health tab): dead crons (>48h silent), signal funnel per analyst, ticker concentration (7d), novelty histogram, monitor ROI sorted by successScore." },
    ],
    tools: [
      { name: "Alpaca Prices", provider: "alpaca", summary: "Live and closing prices for all open positions.",
        resources: [{ source: "alpaca", title: "Latest prices", description: "Batch price lookup for all open positions.", type: "api", endpointOrPath: "getLatestPrices(symbols)", exampleOutput: "NVDA $134.23 · AAPL $192.40 · AMD $178.50" }],
      },
      { name: "GPT-4o Evaluator", provider: "internal", summary: "Post-trade analysis: thesis accuracy, timing, lessons learned.",
        resources: [{ source: "internal", title: "Trade review", description: "Evaluates thesis correctness, entry/exit timing, and writes lessons.", type: "internal", endpointOrPath: "generateObject({ schema: evaluationSchema })", exampleOutput: "Thesis: CORRECT · Timing: EARLY · Lesson: wait for confirmation" }],
      },
      { name: "Monitor ROI walker", provider: "internal", summary: "Follows Thesis.sourceSignalIds → Signal.monitorId → Monitor. Credits the sourcing monitor's trade/win/loss counters and recomputes successScore.",
        resources: [{ source: "internal", title: "Provenance credit", description: "Every position close walks its thesis's cited signals back to the monitors that found them and updates per-monitor performance counters.", type: "db", endpointOrPath: "prisma.monitor.update({ tradesSourced, winsSourced, lossesSourced, successScore })", exampleOutput: "Monitor 'semi AI capex': +1 trade, +1 win, score 0.67" }],
      },
      { name: "GPT-4o Scorer", provider: "internal", summary: "Weekly calibration: does confidence predict actual win rate?",
        resources: [{ source: "internal", title: "Accuracy report", description: "Win rate, calibration analysis, per-sector breakdown.", type: "internal", endpointOrPath: "prisma.accuracyReport.create()", exampleOutput: "Win rate: 62% · Calibration: overconfident at 80%+ · Tech: strong" }],
      },
      { name: "Health dashboard", provider: "internal", summary: "Live observability at /intelligence (Health tab): dead crons, signal funnel, ticker concentration, novelty histogram, monitor ROI table.",
        resources: [{ source: "internal", title: "Pipeline health", description: "Five panels surface dead crons, funnel drop-off per analyst, concentration, novelty distribution, and the top/bottom monitors by successScore.", type: "internal", endpointOrPath: "components/intelligence/health-tab.tsx" }],
      },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

export function getTeam(id: TeamId): Team {
  return TEAMS.find((t) => t.id === id)!;
}

/** Which page maps to which team */
export const PAGE_TEAM_MAP: Record<string, TeamId> = {
  "/": "agent", // Dashboard — shows the full daily cycle
  "/analysts": "builder",
  "/analysts/new": "builder",
  "/runs": "agent",
  "/trades": "agent",
  "/performance": "evaluation",
  "/intelligence": "intelligence",
};

// ── Markdown export ────────────────────────────────────────────────────────

export function exportWorkflowAsMarkdown(): string {
  const lines: string[] = [
    "# Hindsight Workflow",
    "",
    "AI-powered paper trading platform. 5 teams work together in a daily loop.",
    "",
  ];

  for (const team of TEAMS) {
    lines.push(`## ${team.title}`);
    lines.push("");
    lines.push(`${team.summary}`);
    if (team.model) lines.push(`Model: ${team.model}`);
    lines.push(`Schedule: ${team.schedule}`);
    lines.push("");

    lines.push("### Steps");
    for (const step of team.substeps) {
      const time = step.time ? ` (${step.time})` : "";
      lines.push(`- **${step.title}**${time}: ${step.summary}`);
    }
    lines.push("");

    lines.push("### Tools");
    for (const tool of team.tools) {
      lines.push(`- **${tool.name}** [${tool.provider}]: ${tool.summary}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ── Tools Registry ──────────────────────────────────────────────────────────
// Single deduplicated list of all agent tools with categorization and
// per-agent assignments. Powers the /agent-workflow tools registry section.

export type ToolCategory = "intelligence" | "research" | "action" | "system";

export interface RegistryTool {
  name: string;
  category: ToolCategory;
  summary: string;
  providers: string[];
  /** Which team IDs have this tool active */
  agents: TeamId[];
  resources?: Resource[];
}

export const TOOL_REGISTRY: RegistryTool[] = [
  // ── Intelligence (Stage 1 — read pre-gathered data) ──────────────────
  {
    name: "read_morning_brief",
    category: "intelligence",
    summary: "Today's pre-generated intelligence brief — market context, portfolio alerts, watchlist updates, new opportunities, attention priority, risk flags. Grounded to today's routes only.",
    providers: ["internal"],
    agents: ["agent"],
  },
  {
    name: "read_signals",
    category: "intelligence",
    summary: "Signals routed to this analyst by the signal router. Returns three buckets — portfolioSignals, watchlistSignals, discoverySignals — each with signalId for thesis provenance. Reading flips route status PENDING → READ.",
    providers: ["internal"],
    agents: ["agent"],
  },
  {
    name: "read_artifact",
    category: "intelligence",
    summary: "Full extracted article content behind a signal — clean markdown from Firecrawl.",
    providers: ["internal"],
    agents: ["agent"],
  },
  {
    name: "read_analyst_inbox_stats",
    category: "intelligence",
    summary: "30-day rollup of this analyst's routing — top tickers, sectors, themes, dead themes, signal distribution, hot unwatched tickers. Grounds editor fence/archetype changes in real inbox data.",
    providers: ["internal"],
    agents: ["editor"],
  },
  {
    name: "read_knowledge_library",
    category: "intelligence",
    summary: "Browses strategy archetypes (playbooks), vetted research sources, and signal-type taxonomy. Mandatory before suggest_config in builder/editor.",
    providers: ["internal"],
    agents: ["builder", "editor"],
  },
  {
    name: "discover_signals_for_fence",
    category: "intelligence",
    summary: "Runs a live query against real signals matching a proposed universe (sectors + industries + themes + tickers). Returns frequency-ranked tickers for watchlist seeding and validates that the fence actually produces routes.",
    providers: ["internal"],
    agents: ["builder", "editor"],
  },
  {
    name: "web_search",
    category: "intelligence",
    summary: "Live Perplexity Sonar search for breaking news or niche topics. Agent mode respects intelligencePolicy.liveSearchBudget per run.",
    providers: ["perplexity"],
    agents: ["builder", "editor", "agent"],
    resources: [{ source: "perplexity", title: "Sonar web search", description: "Real-time web search with recency filtering.", type: "api", endpointOrPath: "searchSignals(query, { recency })", exampleOutput: "5 results · sentiment: bullish · urgency: MEDIUM", notes: ["Agent per-run budget from intelligencePolicy"] }],
  },
  // ── Research (Stage 2 — live market data) ────────────────────────────
  {
    name: "get_market_context",
    category: "research",
    summary: "SPY, VIX, 11 sector ETFs, macro events, earnings density, and regime classification.",
    providers: ["finnhub", "fmp"],
    agents: ["builder", "editor", "agent"],
    resources: TOOL_GET_MARKET_CONTEXT.resources,
  },
  {
    name: "get_portfolio_context",
    category: "research",
    summary: "Live portfolio snapshot for the agent's analyst: open positions with current P&L, days held, distance from peak, exit levels, original thesis reasoning. Called at the start of Stage 2.",
    providers: ["internal"],
    agents: ["agent"],
  },
  {
    name: "get_stock_data",
    category: "research",
    summary: "Quote, company profile, financials, technicals, analyst consensus, price targets, and news for one ticker.",
    providers: ["finnhub", "fmp"],
    agents: ["builder", "editor", "agent"],
    resources: TOOL_GET_STOCK_DATA.resources,
  },
  {
    name: "get_earnings_data",
    category: "research",
    summary: "Next report date, EPS estimates, and beat rate track record. Called only when earnings are within 2 weeks.",
    providers: ["finnhub"],
    agents: ["builder", "editor", "agent"],
    resources: TOOL_GET_EARNINGS_DATA.resources,
  },
  {
    name: "get_options_flow",
    category: "research",
    summary: "Put/call ratio, unusual contracts, and institutional positioning. Called only when unusual activity flagged.",
    providers: ["fmp"],
    agents: ["agent"],
    resources: [{ source: "fmp", title: "Options chain analysis", description: "P/C ratio, unusual volume/OI contracts, premium flags.", type: "api", endpointOrPath: "/options/chain/{ticker}", exampleOutput: "P/C 0.65 (bullish) · 3 unusual contracts", notes: ["Flags vol/OI ≥ 5x or premium ≥ $500K"] }],
  },
  {
    name: "get_sec_filings",
    category: "research",
    summary: "Recent SEC filings — 10-K, 10-Q, 8-K, Form 4. Called only when insider filing or material 8-K flagged.",
    providers: ["sec"],
    agents: ["builder", "agent"],
    resources: TOOL_GET_SEC_FILINGS.resources,
  },
  // ── Action (write/execute) ────────────────────────────────────────────
  {
    name: "ask_question",
    category: "action",
    summary: "Structured interview with 2-5 quick-reply options. One per turn. Mandatory before suggest_config in builder/editor.",
    providers: ["internal"],
    agents: ["builder", "editor"],
  },
  {
    name: "record_thesis",
    category: "action",
    summary: "Records a LONG/SHORT/PASS verdict with confidence, entry/target/stop, bullets, risk flags. Requires source_kind (ROUTED_SIGNAL | WEB_SEARCH | WATCHLIST_REVIEW | POSITION_REVIEW); ROUTED_SIGNAL requires source_signal_ids validated against today's route pool. Cited routes flip to ACTED_ON.",
    providers: ["internal"],
    agents: ["agent"],
  },
  {
    name: "place_trade",
    category: "action",
    summary: "Places a paper market order on Alpaca. Waits for fill and records position + trade decision in DB. Requires thesis_id from record_thesis. Enforces minConfidence, maxPositionSize, maxOpenPositions.",
    providers: ["alpaca", "internal"],
    agents: ["agent"],
    resources: [
      { source: "alpaca", title: "Submit order", description: "Market buy/sell at current price.", type: "api", endpointOrPath: "placeMarketOrder({ symbol, qty, side })", exampleOutput: "BUY 74 shares NVDA @ $134.23" },
      { source: "alpaca", title: "Confirm fill", description: "Waits up to 5s for fill confirmation.", type: "api", endpointOrPath: "getOrder(orderId)", exampleOutput: "FILLED · Avg $134.23" },
      { source: "internal", title: "Record position", description: "Saves position, logs trade decision, graduates watchlist items.", type: "db", endpointOrPath: "prisma.position.create()", notes: ["Blocks duplicate positions in same ticker"] },
    ],
  },
  {
    name: "close_position",
    category: "action",
    summary: "Closes an existing open position fully via Alpaca. Records outcome with exit reason and realized P&L. Use manage_position for partial exits or target/stop changes.",
    providers: ["alpaca", "internal"],
    agents: ["agent"],
    resources: [
      { source: "alpaca", title: "Sell all shares", description: "Closes the full position.", type: "api", endpointOrPath: "closeOpenPosition(symbol)", exampleOutput: "Closed 50 AAPL @ $192.40 · +$710 (+7.9%)" },
      { source: "internal", title: "Record outcome", description: "Marks position closed with P&L and reason.", type: "db", endpointOrPath: "prisma.tradeDecision.create({ SELL })", exampleOutput: "EXIT: TARGET · WIN · +$710" },
    ],
  },
  {
    name: "manage_position",
    category: "action",
    summary: "Nuanced position management: partial_close, update_targets, move_stop_to_breakeven, set_trailing_stop, add_to_position. Every action audit-logged with a required reason.",
    providers: ["alpaca", "internal"],
    agents: ["agent"],
  },
  {
    name: "manage_watchlist",
    category: "action",
    summary: "Adds, updates, or removes watchlist items with priority, catalyst notes, and conviction level. Narrated watchlist updates without a tool call are a run failure.",
    providers: ["internal"],
    agents: ["agent"],
  },
  {
    name: "suggest_config",
    category: "action",
    summary: "Emits the complete analyst config for side-panel review. Validated: watchlist must fit inside market-cap fence; industries auto-filled from sectors if missing; sentinel-0 marketCap bounds are stripped.",
    providers: ["internal"],
    agents: ["builder", "editor"],
  },
  // ── System (run lifecycle) ────────────────────────────────────────────
  {
    name: "record_run_summary",
    category: "system",
    summary: "Structured per-ticker recap: ranked picks with actual actions taken, and portfolio exposure breakdown.",
    providers: ["internal"],
    agents: ["agent"],
  },
  {
    name: "complete_run",
    category: "system",
    summary: "No-args. Marks the run COMPLETE in DB and triggers the briefing agent inline. Blocked until every researched ticker has a thesis. Always the final tool call.",
    providers: ["internal"],
    agents: ["agent"],
  },
];
