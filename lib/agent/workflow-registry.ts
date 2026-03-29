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
  | "intelligence"
  | "agent"
  | "briefing"
  | "evaluation";

export interface Team {
  id: TeamId;
  title: string;
  /** 1-2 sentences max */
  summary: string;
  icon: LucideIcon;
  /** Model used, if any */
  model?: string;
  /** When this team runs */
  schedule: string;
  substeps: SubStep[];
  tools: ToolEntry[];
}

// ── Teams ──────────────────────────────────────────────────────────────────

export const TEAMS: Team[] = [
  // ─── 1. Analyst Builder ────────────────────────────────────────────────
  {
    id: "builder",
    title: "Analyst Builder",
    summary:
      "Creates and edits analyst personas through AI conversation. Researches live market data to propose a complete strategy, trading rules, watchlist, and intelligence setup.",
    icon: Sparkles,
    model: "GPT-4o",
    schedule: "On demand",
    substeps: [
      { title: "Understand vision", summary: "You describe trading interests, sectors, and risk appetite in conversation." },
      { title: "Research market", summary: "Builder pulls live market data to ground its suggestions in reality." },
      { title: "Craft strategy", summary: "Writes a 3-5 paragraph strategy document — the analyst's playbook." },
      { title: "Configure parameters", summary: "Sets direction bias, hold durations, confidence threshold, position sizing, sectors." },
      { title: "Propose monitors", summary: "Creates 4-6 domain monitors and 3-5 search monitors for the intelligence pipeline." },
      { title: "Review & create", summary: "Full config appears in a side panel. Iterate via chat, then click Create." },
    ],
    tools: [
      { name: "get_market_context", provider: "finnhub", summary: "SPY, VIX, 11 sector ETFs, macro events, regime classification." },
      { name: "get_stock_data", provider: "finnhub", summary: "Price, company profile, financials, technicals, Wall Street consensus, news." },
      { name: "get_earnings_data", provider: "finnhub", summary: "Next report date, EPS estimates, beat rate over last 8 quarters." },
      { name: "get_sec_filings", provider: "sec", summary: "Recent 10-K, 10-Q, 8-K filings and insider Form 4 transactions." },
      { name: "suggest_config", provider: "internal", summary: "Outputs the complete analyst configuration for review." },
    ],
  },

  // ─── 2. Intelligence Pipeline ──────────────────────────────────────────
  {
    id: "intelligence",
    title: "Intelligence Pipeline",
    summary:
      "Five background jobs run every weekday morning before analysts wake up. Gathers market news, checks tracked sources, routes findings to analysts, and writes personalized morning briefs.",
    icon: Radar,
    schedule: "6:30–7:45 AM ET weekdays",
    substeps: [
      { title: "Search monitors", time: "6:30 AM", summary: "Runs all search queries via Perplexity Sonar. Fetches FMP market movers and Finnhub earnings calendar." },
      { title: "Ticker monitors", time: "7:00 AM", summary: "Searches for news on every open position and watchlist ticker. Deduplicates across analysts." },
      { title: "Domain monitors", time: "7:15 AM", summary: "Checks tracked websites via domain-filtered Sonar. Extracts full articles via Firecrawl for high-priority sources." },
      { title: "Signal router", time: "7:30 AM", summary: "Scores findings against each analyst (+40 ticker, +20 sector, +15 theme, +15/+10 urgency). Routes at threshold 15." },
      { title: "Morning brief", time: "7:45 AM", summary: "GPT-4o synthesizes routed findings into a brief: market context, portfolio alerts, watchlist updates, opportunities, risk flags." },
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
      "Runs structured 8-phase research sessions. Reads pre-gathered intelligence, reviews holdings and watchlist, discovers opportunities, forms theses, and executes paper trades.",
    icon: Bot,
    model: "GPT-4.1",
    schedule: "8:00 AM ET daily + on demand",
    substeps: [
      { title: "Portfolio check-in", summary: "Acknowledges open positions, references prior brief's watch-tomorrow items. No tools." },
      { title: "Read intelligence", summary: "Reads morning brief and routed signals. Skips market context if brief is fresh." },
      { title: "Orient", summary: "Optionally checks live SPY/VIX/sector data if brief is stale or missing." },
      { title: "Review holdings", summary: "Triages positions near targets/stops, with earnings, or flagged in brief." },
      { title: "Review watchlist", summary: "Checks watchlist items by priority — triggers, catalysts, and news." },
      { title: "Discover", summary: "Researches 2-4 new opportunities from signals. Validates with live data." },
      { title: "Synthesize", summary: "Portfolio-level reasoning. Outputs decision table — no tools, pure thinking." },
      { title: "Execute", summary: "Exits before entries. Places trades, closes positions, updates watchlist." },
      { title: "Wrap up", summary: "Calls complete_run with ranked picks, market summary, and risk notes." },
    ],
    tools: [
      // Discovery
      { name: "read_morning_brief", provider: "internal", summary: "Pre-generated intelligence brief with market context, alerts, and opportunities." },
      { name: "read_signals", provider: "internal", summary: "Findings routed by background jobs, filtered by tickers/themes/urgency." },
      { name: "read_artifact", provider: "internal", summary: "Full extracted article content behind a signal (up to 4,000 chars)." },
      { name: "web_search", provider: "perplexity", summary: "Live Perplexity Sonar search for breaking news or niche topics (budget-limited)." },
      {
        name: "get_market_context", provider: "finnhub", summary: "SPY, VIX, sector ETFs, macro events, regime classification.",
        resources: [
          { source: "finnhub", title: "Index & sector quotes", description: "SPY, VIX, and 11 sector ETFs in a single batch.", type: "api", endpointOrPath: "/quote?symbol=SPY,^VIX,XLK,...", exampleOutput: "SPY $542.31 +0.8% · VIX 14.2 · XLK +1.2% (leading)" },
          { source: "finnhub", title: "Broad market trend", description: "30 days of SPY candles to determine uptrend/downtrend.", type: "api", endpointOrPath: "/stock/candle?symbol=SPY&resolution=D", exampleOutput: "SPY above SMA-20 ($538.50) → uptrend" },
          { source: "finnhub", title: "Earnings density", description: "How many companies report this week.", type: "api", endpointOrPath: "/calendar/earnings", exampleOutput: "47 companies reporting — elevated density" },
          { source: "fmp", title: "Economic calendar", description: "Major macro events today — Fed, CPI, jobs.", type: "api", endpointOrPath: "/economic_calendar", exampleOutput: "CPI release 8:30 AM (high impact)" },
        ],
      },
      // Research
      {
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
      },
      {
        name: "get_options_flow", provider: "fmp", summary: "Put/call ratio, unusual contracts, institutional positioning.",
        resources: [
          { source: "fmp", title: "Options chain analysis", description: "P/C ratio, unusual volume/OI contracts, premium flags.", type: "api", endpointOrPath: "/options/chain/{ticker}", exampleOutput: "P/C 0.65 (bullish) · 3 unusual contracts", notes: ["Flags vol/OI ≥ 5x or premium ≥ $500K"] },
        ],
      },
      {
        name: "get_earnings_data", provider: "finnhub", summary: "Next report date, EPS estimates, beat rate track record.",
        resources: [
          { source: "finnhub", title: "Next report date", description: "When, before/after market, EPS/rev estimates.", type: "api", endpointOrPath: "/calendar/earnings?symbol={ticker}", exampleOutput: "Reports Mar 26 AMC · EPS est $0.84" },
          { source: "finnhub", title: "Track record", description: "Last 8 quarters actual vs expected.", type: "api", endpointOrPath: "/stock/earnings?symbol={ticker}&limit=8", exampleOutput: "Beat rate 87.5% (7/8) · Last Q +5.9%" },
        ],
      },
      {
        name: "get_sec_filings", provider: "sec", summary: "Recent SEC filings — 10-K, 10-Q, 8-K, Form 4.",
        resources: [
          { source: "sec", title: "Company lookup", description: "Finds SEC CIK identifier.", type: "api", endpointOrPath: "sec.gov/files/company_tickers.json", exampleOutput: "NVDA → CIK 0001045810" },
          { source: "sec", title: "Recent filings", description: "Last 8 filings — annuals, quarterlies, material events, insider trades.", type: "api", endpointOrPath: "data.sec.gov/submissions/CIK{cik}.json", exampleOutput: "8-K Mar 15 · Form 4 — insider sale 50K shares" },
        ],
      },
      // Decision
      { name: "record_thesis", provider: "internal", summary: "Records LONG/SHORT/PASS verdict with confidence, targets, reasoning." },
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
        name: "close_position", provider: "alpaca", summary: "Closes an open position with exit reason and realized P&L.",
        resources: [
          { source: "alpaca", title: "Sell all shares", description: "Closes the full position.", type: "api", endpointOrPath: "closeOpenPosition(symbol)", exampleOutput: "Closed 50 AAPL @ $192.40 · +$710 (+7.9%)" },
          { source: "internal", title: "Record outcome", description: "Marks position closed with P&L and reason.", type: "db", endpointOrPath: "prisma.tradeDecision.create({ SELL })", exampleOutput: "EXIT: TARGET · WIN · +$710" },
        ],
      },
      { name: "manage_watchlist", provider: "internal", summary: "Adds/updates/removes watchlist items with priority and catalysts." },
      // Synthesis
      { name: "complete_run", provider: "internal", summary: "Wraps up session with ranked picks, market summary, risk notes." },
    ],
  },

  // ─── 4. Briefing Agent ─────────────────────────────────────────────────
  {
    id: "briefing",
    title: "Briefing Agent",
    summary:
      "A separate GPT-4o agent reviews each research session and writes a standup memo. This is the analyst's memory — it feeds into the next run's system prompt.",
    icon: RotateCcw,
    model: "GPT-4o",
    schedule: "After every run",
    substeps: [
      { title: "Read transcript", summary: "Reads the full conversation — every message, tool call, and result from the session." },
      { title: "Review portfolio", summary: "Checks current positions with unrealized P&L, trade outcomes, and pass decisions." },
      { title: "Write standup", summary: "Produces narrative, strategy notes, market posture, watch-tomorrow items, and self-corrections." },
      { title: "Create monitors", summary: "Generates 0-5 temporary search monitors with expiration dates for next morning's sweep." },
    ],
    tools: [
      { name: "Conversation transcript", provider: "internal", summary: "Full research session messages, tool calls, and results (~12k chars)." },
      { name: "Portfolio state", provider: "internal", summary: "Open positions, unrealized P&L, capital deployed, win rate." },
      { name: "GPT-4o Reviewer", provider: "internal", summary: "Writes an external review — not self-reported by the research agent." },
    ],
  },

  // ─── 5. Evaluation ─────────────────────────────────────────────────────
  {
    id: "evaluation",
    title: "Evaluation & Tracking",
    summary:
      "Background jobs that monitor positions hourly, evaluate closed trades, snapshot EOD prices, and score analyst accuracy weekly.",
    icon: BarChart3,
    schedule: "Hourly / EOD / Weekly",
    substeps: [
      { title: "Price monitor", time: "Hourly", summary: "Checks all open positions via Alpaca. Flags positions near target (80%) or stop-loss." },
      { title: "Trade evaluator", time: "On close", summary: "GPT-4o reviews each closed trade — was the thesis correct? What's the lesson?" },
      { title: "EOD snapshot", time: "4 PM ET", summary: "Captures closing prices for all positions. Builds the equity curve." },
      { title: "Accuracy scorer", time: "Sunday 10 AM", summary: "Calculates win rate, confidence calibration, and per-sector performance." },
    ],
    tools: [
      { name: "Alpaca Prices", provider: "alpaca", summary: "Live and closing prices for all open positions." },
      { name: "GPT-4o Evaluator", provider: "internal", summary: "Post-trade analysis: thesis accuracy, timing, lessons learned." },
      { name: "GPT-4o Scorer", provider: "internal", summary: "Weekly calibration: does confidence predict actual win rate?" },
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
