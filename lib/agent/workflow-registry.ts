// ── Workflow Registry ──────────────────────────────────────────────────────
// Single source of truth for Hindsight's operational flow — the canonical
// description of WHAT THE SYSTEM HAS TODAY. Powers the /agent-workflow
// page (full flow) and each page's HowItWorksSheet (single team).
//
// Out of scope here: podcast feature (own modes/tools, not part of core
// trading loop). For the intended target state see docs/VISION.md.
// For known gaps between this registry and that vision, see docs/GAPS.md.
//
// Update this file whenever any team / cron / tool / prompt changes,
// and bump LAST_VERIFIED_AT below.

/** ISO date the registry was last manually verified against the codebase. */
export const LAST_VERIFIED_AT = "2026-05-22"; // bumped: PROMOTED thesis status for first-live-run conviction-pause (alongside trading environment PAPER/LIVE and THESIS_RESEARCH_V2 Phase 1)

/**
 * Live thesis-system reference. Linked from the agent / tactical /
 * discovery team cards on /agent-workflow as a "see also."
 */
export const THESIS_ARCHITECTURE_DOC = "docs/THESIS_ARCHITECTURE.md";

import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  Radar,
  Search,
  BarChart3,
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
  Zap,
  Bell,
} from "lucide-react";

// ── Phases ─────────────────────────────────────────────────────────────────
// Cards on /agent-workflow group under one of these four phase labels.
// Pure layout grouping — domain logic doesn't depend on phase.

export type Phase = "build" | "signals" | "run" | "track";

export const PHASE_LABELS: Record<Phase, string> = {
  build:   "Build your analysts",
  signals: "Gather signals",
  run:     "Run your analysts",
  track:   "Learn & track",
};

export const PHASE_ORDER: Phase[] = ["build", "signals", "run", "track"];

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
  | "triggers"
  | "discovery"
  | "agent"
  | "tactical"
  | "thesis-writer"
  | "briefing"
  | "evaluation";

export interface Team {
  id: TeamId;
  title: string;
  /** Which phase column this team renders under on /agent-workflow */
  phase: Phase;
  /** 1-2 sentences — shown on workflow page rows */
  summary: string;
  /** 3-5 sentences — shown in the sheet */
  description?: string;
  icon: LucideIcon;
  /** Model used, if any */
  model?: string;
  /** When this team runs */
  schedule: string;
  /**
   * Upstream relation chip rendered in the bottom row of the card. Used
   * for any kind of relationship — direct event triggers ("Triggered by"),
   * cron-after-cron ordering ("After"), or shared-data dependencies
   * ("Using signals from"). The verb sets the connector phrasing.
   */
  upstream?: { teamId: TeamId; verb: string };
  substeps?: SubStep[];
  tools?: ToolEntry[];
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
    phase: "build",
    summary:
      "A guided interview that turns the edge you want to hunt into a working analyst, grounded in the actual signal pipeline before anything gets written.",
    icon: Sparkles,
    model: "GPT-4o",
    schedule: "On demand",
    getPrompt: () => import("@/lib/agent/builder-prompt-template").then((m) => m.BUILDER_PROMPT_TEMPLATE),
    promptSource: "lib/agent/modes.ts → BUILDER_SYSTEM_PROMPT",
  },

  // ─── 1b. Analyst Editor ────────────────────────────────────────────────
  {
    id: "editor",
    title: "Analyst Editor",
    phase: "build",
    summary:
      "Refines an existing analyst by figuring out the size of your change first, then does only as much rewriting as the change actually needs.",
    icon: Wrench,
    model: "GPT-4o",
    schedule: "On demand",
    getPrompt: () => import("@/lib/agent/builder-prompt-template").then((m) => m.EDITOR_PROMPT_TEMPLATE),
    promptSource: "lib/agent/modes.ts → EDITOR_SYSTEM_PROMPT",
  },

  // ─── 2. Intelligence Pipeline ──────────────────────────────────────────
  {
    id: "intelligence",
    title: "Intelligence Pipeline",
    phase: "signals",
    summary:
      "The signal-gathering pipeline. Sweeps the market, monitors portfolio + watchlist tickers, checks tracked sources, and routes every finding into each analyst's universe.",
    icon: Radar,
    schedule: "6:30–7:30 AM ET weekdays",
  },

  // ─── 2b. Trigger Evaluator ─────────────────────────────────────────────
  {
    id: "triggers",
    title: "Trigger Evaluator",
    phase: "signals",
    summary:
      "Checks every active thesis's structured predicates against fresh prices and just-arrived signals. Fires thesis.trigger.fired when one hits — that's what wakes a tactical run.",
    icon: Bell,
    schedule: "Hourly during market hours + on signal.routed",
    promptSource: "lib/agent/triggers/evaluate.ts",
  },

  // ─── 3a. Discovery Run ─────────────────────────────────────────────────
  {
    id: "discovery",
    title: "Discovery Run",
    phase: "run",
    summary:
      "Per analyst: scans the past week's discovery signals, scores the top 2-3 candidates, mints up to 5 new WATCHING theses. The cadence safety net for new coverage.",
    icon: Search,
    model: "GPT-4o",
    schedule: "Sundays 9 AM ET (weekly)",
    promptSource: "lib/agent/system-prompts/discovery.ts",
  },

  // ─── 3. Daily Run (Research Agent) ─────────────────────────────────────
  {
    id: "agent",
    title: "Daily Run",
    phase: "run",
    summary:
      "Per-analyst portfolio review every weekday morning. The analyst reviews every holding and watchlist name, updates the theses where new evidence arrived, and trades when conviction is there.",
    icon: Bot,
    model: "GPT-4o",
    schedule: "8:00 AM ET weekdays (daily)",
    getPrompt: () => import("@/lib/agent/system-prompt-template").then((m) => m.SYSTEM_PROMPT_TEMPLATE),
    promptSource: "lib/agent/system-prompt-template.ts",
  },

  // ─── 3c. Tactical Run ──────────────────────────────────────────────────
  {
    id: "tactical",
    title: "Tactical Run",
    phase: "run",
    upstream: { teamId: "triggers", verb: "Triggered by" },
    summary:
      "Single-thesis, single-decision focused run. ~15 steps. Validates the trigger that fired, acts (trade or update), writes update_thesis as the close-out.",
    icon: Zap,
    model: "GPT-4o",
    schedule: "Event-driven",
    promptSource: "lib/agent/system-prompts/intraday-tactical.ts",
  },

  // ─── 3d. Thesis Writer ─────────────────────────────────────────────────
  {
    id: "thesis-writer",
    title: "Thesis Writer",
    phase: "run",
    summary:
      "Focused sub-agent that produces one deep-research thesis on one ticker. Spawned on-demand via dispatch_thesis_research. Pulls 7 structured-data sources in parallel, then synthesizes a multi-section equity-research note via Claude Sonnet 4.6 + native web search.",
    icon: FileText,
    model: "Claude Sonnet 4.6",
    schedule: "Event-driven (app/thesis.write.requested)",
    promptSource: "lib/agent/run-thesis-writer.ts → buildThesisWriterSystemPrompt",
  },

  // ─── 4. Evaluation ─────────────────────────────────────────────────────
  {
    id: "evaluation",
    title: "Evaluation & Tracking",
    phase: "track",
    summary:
      "Watches positions hourly. Evaluates each closed trade and credits the source monitor (win/loss). Snapshots EOD prices. Scores weekly accuracy. /intelligence (Health) surfaces pipeline drift.",
    icon: BarChart3,
    schedule: "Hourly / EOD / Weekly + on every close",
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

/**
 * Returns the workflow TeamId that best matches a given ResearchRun.mode.
 * Used by /runs/[id] so the HowItWorksSheet shows the right agent's
 * workflow — tactical runs see the Tactical Run sheet, discovery runs
 * see the Discovery Run sheet, everything else falls back to the Daily
 * Run sheet.
 */
export function getTeamForRunMode(mode: string | null | undefined): TeamId {
  switch (mode) {
    case "INTRADAY_TACTICAL":
      return "tactical";
    case "DISCOVERY":
      return "discovery";
    case "THESIS_WRITER":
      return "thesis-writer";
    case "MORNING_PLAN":
    default:
      return "agent";
  }
}

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
    for (const step of (team.substeps ?? [])) {
      const time = step.time ? ` (${step.time})` : "";
      lines.push(`- **${step.title}**${time}: ${step.summary}`);
    }
    lines.push("");

    lines.push("### Tools");
    for (const tool of (team.tools ?? [])) {
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
    name: "read_signals",
    category: "intelligence",
    summary: "Signals routed to this analyst by the signal router. Returns three buckets — portfolioSignals, watchlistSignals, discoverySignals — each with signalId for thesis provenance. Reading flips route status PENDING → READ.",
    providers: ["internal"],
    agents: ["agent", "discovery"],
  },
  {
    name: "read_artifact",
    category: "intelligence",
    summary: "Full extracted article content behind a signal — clean markdown from Firecrawl.",
    providers: ["internal"],
    agents: ["agent", "tactical", "discovery"],
  },
  {
    name: "get_theses",
    category: "intelligence",
    summary: "Read this analyst's durable thesis library. Default returns ACTIVE + WATCHING (the live coverage book). Filter by ticker / id / status / horizon. include_history=true returns the recent activity log per thesis — used in tactical mode (one ticker, full history) and the daily-run per-thesis review loop.",
    providers: ["internal"],
    agents: ["agent", "tactical", "discovery"],
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
    summary: "Live web search. Most modes use Perplexity Sonar; thesis-writer overrides this slot with Anthropic's native web_search tool (server-side, executed by Claude). Agent mode respects intelligencePolicy.liveSearchBudget per run.",
    providers: ["perplexity", "anthropic"],
    agents: ["builder", "editor", "agent", "tactical", "discovery", "thesis-writer"],
    resources: [{ source: "perplexity", title: "Sonar web search", description: "Real-time web search with recency filtering.", type: "api", endpointOrPath: "searchSignals(query, { recency })", exampleOutput: "5 results · sentiment: bullish · urgency: MEDIUM", notes: ["Agent per-run budget from intelligencePolicy"] }],
  },
  // ── Research (Stage 2 — live market data) ────────────────────────────
  {
    name: "get_market_context",
    category: "research",
    summary: "SPY, VIX, 11 sector ETFs, macro events, earnings density, and regime classification.",
    providers: ["finnhub", "fmp"],
    agents: ["builder", "editor", "agent", "tactical", "discovery"],
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
    agents: ["builder", "editor", "agent", "tactical", "discovery", "thesis-writer"],
    resources: TOOL_GET_STOCK_DATA.resources,
  },
  {
    name: "get_earnings_data",
    category: "research",
    summary: "Per-ticker earnings detail — next report date, EPS estimates, beat rate track record. Called only when earnings are within ~2 weeks. Use get_earnings_calendar for the firm-wide calendar.",
    providers: ["finnhub"],
    agents: ["builder", "editor", "agent", "tactical", "discovery"],
    resources: TOOL_GET_EARNINGS_DATA.resources,
  },
  {
    name: "get_earnings_calendar",
    category: "research",
    summary: "Firm-wide earnings calendar for the next N days. scope:\"coverage\" intersects with watchlist + positions (your book); scope:\"universe\" returns the calendar MINUS already-covered tickers (the discovery set); scope:\"all\" returns the full firehose. Pull-tool counterpart to the EARNINGS_CALENDAR feed subscription. Per-ticker history → get_earnings_data instead.",
    providers: ["finnhub"],
    agents: ["agent"],
    resources: [{ source: "finnhub", title: "Firm earnings calendar", description: "Next N days of upcoming earnings, with ticker / report date / BMO|AMC / EPS estimate.", type: "api", endpointOrPath: "/calendar/earnings?from={today}&to={+Nd}", exampleOutput: "NVDA 2026-05-21 AMC · est $0.84 · …", notes: ["Default 7d window", "scope:\"coverage\" intersects with watchlist + positions; scope:\"universe\" excludes them (discovery)"] }],
  },
  {
    name: "get_market_movers",
    category: "research",
    summary: "Today's market movers — gainers, losers, or most-active. scope:\"coverage\" intersects with watchlist + positions; scope:\"universe\" returns the top-list MINUS already-covered tickers (the discovery set); scope:\"all\" returns the full top-list. Pull-tool counterpart to the MARKET_MOVERS_* feed subscriptions.",
    providers: ["fmp"],
    agents: ["agent"],
    resources: [
      { source: "fmp", title: "Gainers", description: "Top stocks by % gain today.", type: "api", endpointOrPath: "/stock_market/gainers" },
      { source: "fmp", title: "Losers", description: "Top stocks by % loss today.", type: "api", endpointOrPath: "/stock_market/losers" },
      { source: "fmp", title: "Most active", description: "Top stocks by volume today.", type: "api", endpointOrPath: "/stock_market/actives" },
    ],
  },
  {
    name: "get_options_flow",
    category: "research",
    summary: "Put/call ratio, unusual contracts, and institutional positioning. Called only when unusual activity flagged.",
    providers: ["fmp"],
    agents: ["agent", "tactical"],
    resources: [{ source: "fmp", title: "Options chain analysis", description: "P/C ratio, unusual volume/OI contracts, premium flags.", type: "api", endpointOrPath: "/options/chain/{ticker}", exampleOutput: "P/C 0.65 (bullish) · 3 unusual contracts", notes: ["Flags vol/OI ≥ 5x or premium ≥ $500K"] }],
  },
  {
    name: "get_sec_filings",
    category: "research",
    summary: "Recent SEC filings — 10-K, 10-Q, 8-K, Form 4. Called only when insider filing or material 8-K flagged.",
    providers: ["sec"],
    agents: ["builder", "agent", "tactical", "discovery"],
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
    summary: "Mints a NEW thesis (LONG/SHORT). Use this only for fundamentally new coverage or a direction flip. For refinements to an existing thesis (raise target, tighten stop, mark invalidated) use update_thesis instead. Requires source_kind; ROUTED_SIGNAL requires source_signal_ids validated against today's route pool. THESIS_RESEARCH_V2: accepts research_data + research_sections from the thesis-writer agent — they persist on Thesis.researchData / researchSections / researchUpdatedAt.",
    providers: ["internal"],
    agents: ["agent", "discovery", "thesis-writer"],
  },
  {
    name: "update_thesis",
    category: "action",
    summary: "Update an existing thesis durably. Pass thesis_id + the fields changing + a rationale. Every call writes one ThesisUpdate audit row (UPDATED, REVIEWED, INVALIDATED, or CLOSED). The single most-used new tool — every daily-run REVIEWED entry and every tactical close-out is one of these.",
    providers: ["internal"],
    agents: ["agent", "tactical", "thesis-writer"],
  },
  {
    name: "place_trade",
    category: "action",
    summary: "Places a paper market order on Alpaca. Waits for fill and records position + trade decision in DB. Requires thesis_id. Enforces minConfidence, maxPositionSize, maxOpenPositions.",
    providers: ["alpaca", "internal"],
    agents: ["agent", "tactical", "discovery"],
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
    agents: ["agent", "tactical"],
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
    agents: ["agent", "tactical"],
  },
  {
    name: "manage_watchlist",
    category: "action",
    summary: "Adds, updates, or removes watchlist items with priority, catalyst notes, and conviction level. Narrated watchlist updates without a tool call are a run failure.",
    providers: ["internal"],
    agents: ["agent", "discovery"],
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
    summary: "Structured per-ticker recap: ranked picks with actual actions taken, and portfolio exposure breakdown. Tactical mode does NOT call this — its close-out is update_thesis.",
    providers: ["internal"],
    agents: ["agent", "discovery"],
  },
  {
    name: "complete_run",
    category: "system",
    summary: "No-args. Marks the run COMPLETE in DB and triggers the briefing agent inline. Always the final tool call.",
    providers: ["internal"],
    agents: ["agent", "tactical", "discovery", "thesis-writer"],
  },
  // ── THESIS_RESEARCH_V2 Phase 1 ──────────────────────────────────────────
  {
    name: "write_thesis_research",
    category: "research",
    summary: "The thesis-writer meta-tool. ONE call fans out 7 structured-data tools in parallel (financials_deep, analyst_coverage, insider_activity, earnings_history, peers_with_metrics, stock_data, sec_filings), formats into a ~3-5KB markdown ground-truth block, then synthesizes a multi-section equity-research note via Claude Sonnet 4.6 + Anthropic native web_search. Returns { sections, citations, rawDataBlock }.",
    providers: ["internal", "anthropic", "finnhub", "fmp", "sec"],
    agents: ["thesis-writer"],
    resources: [
      { source: "internal", title: "Parallel data pulls", description: "Promise.allSettled over 7 data-layer tools — partial tolerance, errors[] surfaced.", type: "internal", endpointOrPath: "lib/agent/tools/write-thesis-research.ts" },
      { source: "anthropic", title: "Claude Sonnet 4.6 + native web_search", description: "Synthesis call with anthropic.tools.webSearch_20260209({ maxUses: 6 }), stepCountIs(6), 180s abort. Bake-off winner over GPT-5 (fiscal-year hallucination) and Gemini 2.5 Pro (close second, kept as fallback).", type: "api", endpointOrPath: "generateText({ model: anthropic('claude-sonnet-4-6'), tools: { web_search } })" },
      { source: "internal", title: "Section + citation parser", description: "Extracts ## Snapshot / Fundamentals / Latest Earnings / Catalysts / Bull / Bear / Analyst Consensus / Insider+Technical and [STRUCTURED:...] / [WEB:...] markers.", type: "internal", endpointOrPath: "parseIntoSections + parseCitations" },
    ],
  },
  {
    // dispatch_thesis_research lives on Principal Chat (operator UI) — not
    // one of the registered TEAMS, so `agents: []`. Phases 2-4 will add it
    // to "discovery", "agent" (Daily Run), and "tactical" allowlists.
    name: "dispatch_thesis_research",
    category: "system",
    summary: "Orchestrator-side spawner. Creates a child ResearchRun(mode='THESIS_WRITER', parentRunId=<caller>), fires app/thesis.write.requested via Inngest, returns the childRunId immediately. Caller continues; the thesis-writer sub-agent runs asynchronously. Phase 1: only Principal Chat dispatches (operator UI — not a registered TEAMS entry). Phases 2-4 will add Discovery / Daily promote-to-active / Tactical.",
    providers: ["internal", "inngest"],
    agents: [],
    resources: [
      { source: "inngest", title: "app/thesis.write.requested", description: "Consumed by lib/inngest/functions/thesis-writer.ts. concurrency:5. Emits app/thesis.written on completion for Phase-3 waiters.", type: "internal", endpointOrPath: "inngest.send({ name: 'app/thesis.write.requested', data: {...} })" },
    ],
  },
];
