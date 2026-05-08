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
export const LAST_VERIFIED_AT = "2026-05-08";

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
  description: string;
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
    phase: "build",
    summary:
      "A guided interview that turns the edge you want to hunt into a working analyst, grounded in the actual signal pipeline before anything gets written.",
    description:
      "The Builder is a structured interview that turns the edge you want to hunt into a working analyst. You describe the strategy you have in mind; it asks a few targeted questions, picks a fitting playbook from the library, and grounds the proposed universe in the actual signal pipeline before writing anything.\n\nThe output is a complete analyst as a side-panel diff — strategy prompt, universe, trading rules, intelligence policy, watchlist, and a starter set of monitors and discovery queries. You review and accept.",
    icon: Sparkles,
    model: "GPT-4o",
    schedule: "On demand",
    substeps: [
      { title: "Opening question", summary: "First tool call is always ask_question. 2-5 quick-reply options on the edge: earnings, momentum, value, catalyst, thematic." },
      { title: "Narrow with quick replies", summary: "2-3 follow-ups via ask_question (one call per turn — multiple related questions go inside one call via steps[]). Pins direction, hold duration, themes, risk appetite." },
      { title: "Three-beat playbook selection", summary: "Browse the archetype index → present top 2-4 as ask_question options → deep-read the chosen one. Plus topic:\"signal\" for the vetted signal taxonomy and topic:\"source\" for the domain catalog." },
      { title: "Validate against today's tape", summary: "get_market_context for regime + discover_signals_for_fence with the proposed universe. 0 signals = widen. Watchlist tickers come ONLY from tickerFrequency output." },
      { title: "Emit suggest_config", summary: "Full analyst as a side-panel diff: analystPrompt adapted from the skeleton, universe (sectors + industries + themes + marketCap + feeds), trading rules, intelligence policy, watchlist, 4-6 domain monitors, 3-5 discovery queries." },
    ],
    tools: [
      { name: "ask_question", provider: "internal", summary: "Structured interview with 2-5 quick-reply options. One call per turn — bundle related questions inside via steps[]." },
      { name: "read_knowledge_library", provider: "internal", summary: "Strategy archetypes (playbooks) + vetted source catalog + signal-type taxonomy. Topics: archetype | signal | source." },
      { name: "discover_signals_for_fence", provider: "internal", summary: "Validates a proposed universe against the past 30 days of routed signals. Returns frequency-ranked tickers — the only legal source for watchlist seeding." },
      TOOL_GET_MARKET_CONTEXT,
      TOOL_GET_STOCK_DATA,
      TOOL_GET_EARNINGS_DATA,
      TOOL_GET_SEC_FILINGS,
      { name: "web_search", provider: "perplexity", summary: "Live Sonar search for verification within the interview." },
      { name: "suggest_config", provider: "internal", summary: "Emits the complete analyst config as a side-panel diff. Validated: watchlist must fit inside the marketCap fence; industries auto-filled from sectors if missing; sentinel marketCap bounds stripped." },
    ],
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
    description:
      "The Editor refines an existing analyst rather than building one from scratch. It first figures out what kind of change you're asking for — a question, a numeric tweak, a fence change, or a full strategy shift — and matches the size of its rewrite to the size of the change.\n\nSmall changes leave the strategy prompt untouched. Bigger ones ground themselves in 30 days of real routing data before suggesting anything, and only rewrite the parts that actually need to move. Risk and exit discipline that's working gets preserved across every lane.",
    icon: Wrench,
    model: "GPT-4o",
    schedule: "On demand",
    substeps: [
      { title: "Classify the request", summary: "Silent lane decision: (a) Q&A, (b) numeric tweak, (c) fence change, (d) archetype shift. Determines whether analystPrompt is frozen, partially edited, or rewritten." },
      { title: "Ground in real experience", summary: "Lanes (c) and (d): read_analyst_inbox_stats pulls 30 days of routing — top tickers, dead themes, hot unwatched tickers, signal-type distribution." },
      { title: "Pin down ambiguity", summary: "One ask_question per turn with 2-5 options. \"Make more aggressive\" resolves to ONE of: minConfidence, position size, maxOpenPositions, signal type." },
      { title: "Validate fence changes", summary: "discover_signals_for_fence with the PROPOSED fence. 0 signals = push back with evidence. Watchlist preserved + extended; new tickers come only from inboxStats or tickerFrequency, never invented." },
      { title: "Consult playbooks", summary: "Lane (c): re-read current archetype skeleton for consistency. Lane (d): three-beat selection (browse → ask_question → deep-read)." },
      { title: "Emit suggest_config", summary: "Lane (b): analystPrompt unchanged. Lane (c): one fence paragraph woven in, rest preserved. Lane (d): analystPrompt rewritten from the new skeleton. Sectors + industries always together." },
    ],
    tools: [
      { name: "ask_question", provider: "internal", summary: "Structured interview with 2-5 quick-reply options. One call per turn — bundle related questions inside via steps[]." },
      { name: "read_analyst_inbox_stats", provider: "internal", summary: "30-day rollup of this analyst's routing: top tickers, sectors, themes, dead themes, signal distribution, hot unwatched tickers. Mandatory for fence/archetype changes." },
      { name: "read_knowledge_library", provider: "internal", summary: "Strategy archetypes (playbooks) + vetted source catalog + signal-type taxonomy. Topics: archetype | signal | source." },
      { name: "discover_signals_for_fence", provider: "internal", summary: "Validates a proposed fence against the past 30 days of routed signals. 0 signals = fence too narrow. Returns frequency-ranked tickers for watchlist additions." },
      TOOL_GET_MARKET_CONTEXT,
      TOOL_GET_STOCK_DATA,
      TOOL_GET_EARNINGS_DATA,
      { name: "web_search", provider: "perplexity", summary: "Live Sonar search for verification beyond the inbox." },
      { name: "suggest_config", provider: "internal", summary: "Emits the updated analyst as a side-panel diff. Lane-aware: numeric-only never touches analystPrompt; fence changes preserve the rest of the document; archetype shifts rewrite from skeleton." },
    ],
    getPrompt: () => import("@/lib/agent/builder-prompt-template").then((m) => m.BUILDER_PROMPT_TEMPLATE),
    promptSource: "lib/agent/modes.ts → EDITOR_SYSTEM_PROMPT",
  },

  // ─── 2. Intelligence Pipeline ──────────────────────────────────────────
  {
    id: "intelligence",
    title: "Intelligence Pipeline",
    phase: "signals",
    summary:
      "The signal-gathering pipeline. Sweeps the market, monitors portfolio + watchlist tickers, checks tracked sources, and routes every finding into each analyst's universe.",
    description:
      "The Intelligence Pipeline is what makes sure your analysts wake up to fresh signals. Evidence-gatherers run between 6:30 and 7:30 AM ET — firm-wide market sweeps, per-ticker monitors on your portfolio + watchlist, tracked-domain crawls, FMP movers and earnings firehoses, plus inbound newsletter emails whenever they arrive. Each one normalizes its findings into structured Signal rows.\n\nThe signal router then evaluates every Signal against every analyst's universe — sectors, industries, themes, marketCap, and feeds, plus hard watchlist/position bypass — and writes one route per match with a reason code. Routes are scored, novelty-filtered so stale names get crushed, and capped per-analyst with 20% of slots reserved for new discoveries. By the time you open the app, each analyst has its own ranked feed of what to look at.",
    icon: Radar,
    schedule: "6:30–7:30 AM ET weekdays",
    substeps: [
      { title: "Firm market sweep", time: "6:30 AM", summary: "Firm-wide search queries via Perplexity Sonar. Fetches FMP movers (gainers/losers/actives) and the Finnhub earnings calendar. All signals normalized through canonical GICS sectors/industries." },
      { title: "Portfolio & watchlist monitor", time: "7:00 AM", summary: "Per-analyst Sonar searches on every open position and watchlist ticker, with forced ticker injection so the result is guaranteed to tag the target symbol." },
      { title: "Domain monitors", time: "7:15 AM", summary: "Tracked websites checked via domain-filtered Sonar. Firecrawl extracts full articles into Artifact rows so the agent can deep-read the whole page later." },
      { title: "Email ingest", time: "on receipt", summary: "Resend inbound webhook delivers newsletter emails. GPT-4o-mini extracts one signal per distinct investable idea, with tickers, themes, urgency, and sentiment." },
      { title: "Signal router", time: "7:30 AM", summary: "Each Signal evaluated against every analyst's universe. Routes tagged with a reason code, scored, novelty-filtered, and capped per analyst (20% of slots reserved for discovery). Emits app/signal.routed for the Trigger Evaluator to consume." },
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
      {
        name: "Resend Inbound", provider: "internal", summary: "Inbound email webhook. Newsletter emails arrive via Resend; GPT-4o-mini extracts structured signals from the body.",
        resources: [
          { source: "internal", title: "Email ingest webhook", description: "Receives Resend email.received events. Pulls the full body, extracts one signal per distinct investable idea.", type: "internal", endpointOrPath: "app/api/intelligence/email-ingest/route.ts", exampleOutput: "1 newsletter → 3 signals (tickers, themes, urgency, sentiment)" },
        ],
      },
    ],
  },

  // ─── 2b. Trigger Evaluator ─────────────────────────────────────────────
  {
    id: "triggers",
    title: "Trigger Evaluator",
    phase: "signals",
    summary:
      "Checks every active thesis's structured predicates against fresh prices and just-arrived signals. Fires thesis.trigger.fired when one hits — that's what wakes a tactical run.",
    description:
      "The Trigger Evaluator is the reactivity layer between your portfolio and the rest of the world. Every active thesis can carry structured trigger predicates — price levels, technical levels, earnings outcomes, filing types, time elapsed. The evaluator's job is to check those predicates against reality and fire an event when one matches.\n\nTwo paths feed it. The signal-driven path consumes routed signals as they land — earnings beats, guidance changes, 8-K filings — and matches them to signal-side predicates. The cron path runs every 15 minutes during market hours, batch-fetches fresh prices, and matches them to price/time-side predicates. A cooldown gate prevents the same predicate from firing repeatedly. When something fires, it stamps an audit row and emits the event the Tactical Run consumes.",
    icon: Bell,
    schedule: "Hourly during market hours + on signal.routed",
    substeps: [
      { title: "Signal-driven evaluation", summary: "Consumes app/signal.routed. For each (analyst × ticker × thesis × trigger), evaluates signal-side predicates against the routed signal." },
      { title: "Cron-driven evaluation", summary: "Loads all ACTIVE theses with non-empty triggers. Batches Finnhub /quote for unique tickers (≤200). Evaluates price/time-side predicates." },
      { title: "Cooldown gate", summary: "Per-trigger cooldownDays prevents the same predicate from firing twice in the window. EXIT triggers skip cooldown — terminal actions must always fire." },
      { title: "Audit + emit", summary: "Stamps lastFiredAt on the trigger, writes ThesisUpdate(type=TRIGGER_FIRED) with thesisId / triggerId / signalIds, emits app/thesis.trigger.fired." },
    ],
    tools: [
      { name: "Finnhub /quote", provider: "finnhub", summary: "Cron-path price fetch — one call per unique ticker per 15-min interval, capped at 200." },
    ],
    promptSource: "lib/agent/triggers/evaluate.ts",
  },

  // ─── 3a. Discovery Run ─────────────────────────────────────────────────
  {
    id: "discovery",
    title: "Discovery Run",
    phase: "run",
    upstream: { teamId: "intelligence", verb: "Using signals from" },
    summary:
      "Per analyst: scans the past week's discovery signals, scores the top 2-3 candidates, mints up to 5 new WATCHING theses. The cadence safety net for new coverage.",
    description:
      "Discovery Run is how new tickers enter your analyst's coverage. Once a week, every analyst spawns a focused agent that scans the past seven days of signals on names not already in the library, picks the most promising candidates, and mints WATCHING theses with the triggers and rationale that would later promote them to ACTIVE.\n\nIt cannot touch existing coverage — only Daily and Tactical runs can update or close theses. If conviction on a candidate is high enough at discovery time, it can place a starter trade and mint as ACTIVE; otherwise everything goes onto the watchlist for the daily run to evaluate later.",
    icon: Search,
    model: "GPT-4o",
    schedule: "Sundays 9 AM ET (weekly)",
    substeps: [
      { title: "Scan", summary: "read_signals filtered to the discoverySignals bucket. Cross off anything already covered by an active or watching thesis." },
      { title: "Score", summary: "get_stock_data on top 2-3 candidates. Composite score (trendStrength / relativeStrength / entryQuality / catalystFreshness). ≥ 7 required to mint." },
      { title: "Mint", summary: "record_thesis with status=WATCHING (default) or status=ACTIVE + place_trade (high conviction only). Default triggers attach by horizon." },
      { title: "Recap", summary: "record_run_summary then complete_run. Briefing agent fires inline." },
    ],
    tools: [
      { name: "read_signals", provider: "internal", summary: "Routed signals — discovery bucket only. Universe-fenced." },
      { name: "read_artifact", provider: "internal", summary: "Full extracted article behind a candidate signal." },
      TOOL_GET_MARKET_CONTEXT,
      TOOL_GET_STOCK_DATA,
      TOOL_GET_EARNINGS_DATA,
      TOOL_GET_SEC_FILINGS,
      { name: "web_search", provider: "perplexity", summary: "Live Sonar search — sparingly, for niche verification." },
      { name: "get_theses", provider: "internal", summary: "Read the analyst's existing thesis library to confirm a candidate isn't already covered." },
      { name: "record_thesis", provider: "internal", summary: "Mint a new thesis. Default status=WATCHING; ACTIVE only for high-conviction starters that warrant an immediate place_trade." },
      { name: "place_trade", provider: "alpaca", summary: "Optional starter trade for high-conviction (composite ≥ 8) ACTIVE picks." },
      { name: "manage_watchlist", provider: "internal", summary: "Adds for candidates worth tracking but not minting a full thesis." },
      { name: "record_run_summary", provider: "internal", summary: "Per-candidate ranked-picks recap." },
      { name: "complete_run", provider: "internal", summary: "Marks the run COMPLETE and fires the briefing agent inline." },
    ],
    promptSource: "lib/agent/system-prompts/discovery.ts",
  },

  // ─── 3. Daily Run (Research Agent) ─────────────────────────────────────
  {
    id: "agent",
    title: "Daily Run",
    phase: "run",
    summary:
      "Per-analyst portfolio review every weekday morning. The analyst reviews every holding and watchlist name, updates the theses where new evidence arrived, and trades when conviction is there.",
    description:
      "The Daily Run is where your portfolio actually gets managed. Every weekday morning at 8 AM ET, each enabled analyst wakes up, reads its current holdings and watchlist along with whatever signals came in overnight, then goes through each name one at a time and asks: does anything need to change today?\n\nFor most names the answer is no — nothing material happened, so the analyst just logs that it looked and moves on. For the rest, it does fresh research, updates the thesis with what it learned (raise the target, tighten the stop, change conviction), and acts on the position if needed (close, scale in, trim). It can also pick up worthwhile new discovery candidates that came in overnight, and writes a quick recap at the end of what it actually changed.",
    icon: Bot,
    model: "GPT-4o",
    schedule: "8:00 AM ET weekdays (daily)",
    substeps: [
      { title: "Portfolio check-in", summary: "Acknowledges open positions and watchlist items, references priority reviews flagged by the price monitor. Plain text — no tools." },
      { title: "Orient", summary: "read_signals (today's three buckets: portfolio, watchlist, discovery — each carries signalId for provenance) and get_theses with full update history. read_artifact on anything worth a deep read; web_search sparingly within budget." },
      { title: "Per-thesis review", summary: "Goes through every active and watching thesis one at a time. For each: did a trigger fire or new evidence arrive? is a scheduled review due? otherwise → REVIEWED-only. Calls get_stock_data only on theses that warrant real research, not every ticker." },
      { title: "Position management", summary: "close_position / manage_position for held names that warrant action; place_trade for new entries; record_thesis reserved for net-new coverage or direction flips. update_thesis is the close-out for every touched thesis." },
      { title: "Recap", summary: "record_run_summary with ranked picks (every thesis the agent touched + the action that actually happened) and exposure breakdown." },
      { title: "Complete", summary: "complete_run with no arguments. Marks the run COMPLETE; the briefing agent fires inline to write tomorrow's standup." },
    ],
    tools: [
      // Intelligence
      { name: "read_signals", provider: "internal", summary: "Routed signals in three buckets: portfolioSignals, watchlistSignals, discoverySignals. Every signal carries signalId for thesis provenance. Reading flips route status PENDING → READ." },
      { name: "read_artifact", provider: "internal", summary: "Full extracted article content (clean markdown from Firecrawl) behind a signal. Agent passes artifactId from the signal record." },
      { name: "get_theses", provider: "internal", summary: "Read the analyst's durable thesis library. Default returns ACTIVE + WATCHING; include_history=true returns the recent activity log per thesis. Mandatory in Stage 1." },
      { name: "web_search", provider: "perplexity", summary: "Live Perplexity Sonar search for breaking news or niche topics. Respects intelligencePolicy.allowLiveSearch and liveSearchBudget.",
        resources: [{ source: "perplexity", title: "Sonar web search", description: "Real-time web search with recency filtering.", type: "api", endpointOrPath: "searchSignals(query, { recency })", exampleOutput: "5 results · sentiment: bullish · urgency: MEDIUM", notes: ["Per-run budget from analyst's intelligencePolicy"] }],
      },
      TOOL_GET_MARKET_CONTEXT,
      // Research
      { name: "get_portfolio_context", provider: "internal", summary: "Live portfolio snapshot: P&L %, days held, distance from peak price, exit levels, original thesis reasoning. Called at the start of the per-thesis review." },
      TOOL_GET_STOCK_DATA,
      { name: "get_earnings_calendar", provider: "finnhub", summary: "Firm-wide earnings calendar for the next N days. scope:\"universe\" fences to watchlist + open positions; scope:\"all\" returns the full firehose. Pull-tool counterpart to the EARNINGS_CALENDAR feed." },
      { name: "get_market_movers", provider: "fmp", summary: "Today's market movers — gainers, losers, or most-active. scope:\"universe\" fences to watchlist + positions; scope:\"all\" returns the full top-list. Pull-tool counterpart to the MARKET_MOVERS_* feeds." },
      {
        name: "get_options_flow", provider: "fmp", summary: "Put/call ratio, unusual contracts, institutional positioning.",
        resources: [{ source: "fmp", title: "Options chain analysis", description: "P/C ratio, unusual volume/OI contracts, premium flags.", type: "api", endpointOrPath: "/options/chain/{ticker}", exampleOutput: "P/C 0.65 (bullish) · 3 unusual contracts", notes: ["Flags vol/OI ≥ 5x or premium ≥ $500K"] }],
      },
      TOOL_GET_EARNINGS_DATA,
      TOOL_GET_SEC_FILINGS,
      // Decision
      { name: "record_thesis", provider: "internal", summary: "Mints a NEW thesis (LONG/SHORT). Reserved for net-new coverage or a direction flip. Refinements to held names go through update_thesis instead. Requires source_kind; ROUTED_SIGNAL requires source_signal_ids." },
      { name: "update_thesis", provider: "internal", summary: "Update an existing thesis durably. Pass thesis_id + the fields changing + a rationale. Every call writes one ThesisUpdate audit row (UPDATED, REVIEWED, INVALIDATED, CLOSED). The most-used new tool — every per-thesis decision in the daily review writes one of these." },
      // Execution
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
      // Run lifecycle
      { name: "record_run_summary", provider: "internal", summary: "Structured per-ticker recap: ranked picks + exposure breakdown. Pure data." },
      { name: "complete_run", provider: "internal", summary: "No-args. Marks the run complete in the DB and triggers the briefing agent. Always the agent's final tool call." },
    ],
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
    description:
      "The Tactical Run is your portfolio's intraday reflex. When the Trigger Evaluator fires, a tactical agent spawns with a small step budget focused on one thesis and one decision: did this trigger fire for a real reason, and if so, what's the right response?\n\nIt validates against fresh stock data, takes at most one position action (open, close, scale, or adjust), and always writes one update_thesis row as the close-out. It cannot mint new theses — record_thesis isn't in its allowlist. New coverage only happens in the Daily or Discovery runs.",
    icon: Zap,
    model: "GPT-4o",
    schedule: "Event-driven",
    substeps: [
      { title: "Validate", summary: "Read the trigger predicate. Pull fresh stock data. Decide: is the signal/price still actionable?" },
      { title: "Act (optional)", summary: "Up to one position action — place_trade / manage_position / close_position." },
      { title: "Close out", summary: "update_thesis with the decision. UPDATED if fields changed, REVIEWED if not, CLOSED if invalidated." },
      { title: "Complete", summary: "complete_run fires the briefing agent inline." },
    ],
    tools: [
      TOOL_GET_STOCK_DATA,
      TOOL_GET_EARNINGS_DATA,
      TOOL_GET_MARKET_CONTEXT,
      TOOL_GET_SEC_FILINGS,
      { name: "get_options_flow", provider: "fmp", summary: "Put/call ratio, unusual contracts. Validation tool when the trigger is options-related." },
      { name: "web_search", provider: "perplexity", summary: "Live Sonar search — only when the trigger references something the firing signal doesn't fully explain." },
      { name: "read_artifact", provider: "internal", summary: "Full extracted article behind the firing signal." },
      { name: "get_theses", provider: "internal", summary: "Pulls the firing thesis with its full update history." },
      { name: "place_trade", provider: "alpaca", summary: "Open a position when the trigger says ADD or the agent overrides toward entry." },
      { name: "close_position", provider: "alpaca", summary: "Full exit when the trigger fires EXIT (stop hit, target hit, invalidation)." },
      { name: "manage_position", provider: "alpaca", summary: "Partial close, target/stop adjust, trail, or scale-in." },
      { name: "update_thesis", provider: "internal", summary: "REQUIRED close-out call. UPDATED / REVIEWED / CLOSED depending on the decision. record_thesis is not in this allowlist." },
      { name: "complete_run", provider: "internal", summary: "Marks COMPLETE and fires the briefing agent inline." },
    ],
    promptSource: "lib/agent/system-prompts/intraday-tactical.ts",
  },

  // ─── 4. Briefing Agent ─────────────────────────────────────────────────
  {
    id: "briefing",
    title: "Briefing Agent",
    phase: "track",
    upstream: { teamId: "agent", verb: "After" },
    summary:
      "When any agent run completes, GPT-4o reviews the transcript + portfolio and writes the standup memo that feeds into the next run's prompt.",
    description:
      "The Briefing Agent is what gives your analysts continuity between runs. Whenever any agent run completes — daily, tactical, or discovery — the briefing agent fires inline as the run wraps up. It reads the full conversation transcript, the current portfolio with live P&L, and the trade outcomes from the session.\n\nIt writes a structured standup: a narrative of what happened, what's still unresolved, what to watch tomorrow, and any self-corrections worth carrying forward. It can also create a few short-lived search monitors that the next morning's intelligence sweep will run. The standup gets injected into the next run's system prompt — that's how the analyst remembers anything.",
    icon: RotateCcw,
    model: "GPT-4o",
    schedule: "Inline after every run (no separate cron)",
    substeps: [
      { title: "Read context", summary: "Pulls the conversation transcript, current portfolio with live P&L, and recent trade outcomes from the session." },
      { title: "Write standup", summary: "Narrative, strategy notes, market posture, watch-tomorrow items, unresolved items, self-corrections. 400-600 words." },
      { title: "Create monitors", summary: "Generates 0-5 short-lived search monitors with expiration dates. Next morning's intelligence sweep picks them up automatically." },
    ],
    tools: [
      { name: "Conversation transcript", provider: "internal", summary: "Full research session messages, tool calls, and results.",
        resources: [{ source: "internal", title: "Run messages", description: "Complete conversation persisted to RunMessage table.", type: "db", endpointOrPath: "prisma.runMessage.findMany({ runId })", exampleOutput: "47 messages · 12 tool calls · 28k tokens" }],
      },
      { name: "Portfolio state", provider: "internal", summary: "Open positions, unrealized P&L, capital deployed, win rate.",
        resources: [{ source: "internal", title: "Portfolio snapshot", description: "Current positions with live P&L and exposure breakdown.", type: "db", endpointOrPath: "prisma.position.findMany({ status: OPEN })", exampleOutput: "3 positions · $9,870 deployed · 65% win rate" }],
      },
      { name: "GPT-4o Reviewer", provider: "internal", summary: "Writes an external review — not self-reported by the agent that just ran.",
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
    phase: "track",
    summary:
      "Watches positions hourly. Evaluates each closed trade and credits the source monitor (win/loss). Snapshots EOD prices. Scores weekly accuracy. /intelligence (Health) surfaces pipeline drift.",
    description:
      "Evaluation & Tracking is the feedback loop that closes the system. While analysts research and trade, a set of background jobs is watching: the price monitor checks open positions every hour, the trade evaluator fires whenever a position closes, end-of-day snapshots capture closing prices, and a weekly scorer runs Sunday morning.\n\nThe most important piece is the trade evaluator. When a trade closes, it traces back from the thesis to the signals it cited, and credits each source monitor's win/loss counters. Monitors that keep producing losing theses drift toward negative ROI; the Health tab on /intelligence surfaces it. That's what makes the intelligence pipeline self-improving — over time, the analyst learns which sources are worth listening to.",
    icon: BarChart3,
    schedule: "Hourly / EOD / Weekly + on every close",
    substeps: [
      { title: "Price monitor", time: "Hourly", summary: "Checks all open positions via Alpaca. Flags positions near target (80%) or stop-loss; auto-closes hard stops." },
      { title: "Trade evaluator", time: "On close", summary: "GPT-4o reviews each closed trade. Then traces Thesis.sourceSignalIds → Monitor and updates tradesSourced / winsSourced / lossesSourced / successScore." },
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
      { name: "Monitor ROI tracer", provider: "internal", summary: "Follows Thesis.sourceSignalIds → Signal.monitorId → Monitor. Credits the sourcing monitor's trade/win/loss counters and recomputes successScore.",
        resources: [{ source: "internal", title: "Provenance credit", description: "Every position close traces its thesis's cited signals back to the monitors that found them and updates per-monitor performance counters.", type: "db", endpointOrPath: "prisma.monitor.update({ tradesSourced, winsSourced, lossesSourced, successScore })", exampleOutput: "Monitor 'semi AI capex': +1 trade, +1 win, score 0.67" }],
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
    summary: "Live Perplexity Sonar search for breaking news or niche topics. Agent mode respects intelligencePolicy.liveSearchBudget per run.",
    providers: ["perplexity"],
    agents: ["builder", "editor", "agent", "tactical", "discovery"],
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
    agents: ["builder", "editor", "agent", "tactical", "discovery"],
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
    summary: "Firm-wide earnings calendar for the next N days. scope:\"universe\" fences to watchlist + open positions; scope:\"all\" returns the full firehose. Pull-tool counterpart to the EARNINGS_CALENDAR feed subscription. Per-ticker history → get_earnings_data instead.",
    providers: ["finnhub"],
    agents: ["agent"],
    resources: [{ source: "finnhub", title: "Firm earnings calendar", description: "Next N days of upcoming earnings, with ticker / report date / BMO|AMC / EPS estimate.", type: "api", endpointOrPath: "/calendar/earnings?from={today}&to={+Nd}", exampleOutput: "NVDA 2026-05-21 AMC · est $0.84 · …", notes: ["Default 7d window", "scope:\"universe\" intersects with watchlist + open positions"] }],
  },
  {
    name: "get_market_movers",
    category: "research",
    summary: "Today's market movers — gainers, losers, or most-active. scope:\"universe\" fences to watchlist + positions; scope:\"all\" returns the full top-list. Pull-tool counterpart to the MARKET_MOVERS_* feed subscriptions.",
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
    summary: "Mints a NEW thesis (LONG/SHORT). Use this only for fundamentally new coverage or a direction flip. For refinements to an existing thesis (raise target, tighten stop, mark invalidated) use update_thesis instead. Requires source_kind; ROUTED_SIGNAL requires source_signal_ids validated against today's route pool.",
    providers: ["internal"],
    agents: ["agent", "discovery"],
  },
  {
    name: "update_thesis",
    category: "action",
    summary: "Update an existing thesis durably. Pass thesis_id + the fields changing + a rationale. Every call writes one ThesisUpdate audit row (UPDATED, REVIEWED, INVALIDATED, or CLOSED). The single most-used new tool — every daily-run REVIEWED entry and every tactical close-out is one of these.",
    providers: ["internal"],
    agents: ["agent", "tactical"],
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
    agents: ["agent", "tactical", "discovery"],
  },
];
