// ── Tool Registry ──────────────────────────────────────────────────────────
// Structured data for all agent tools. Drives the tool documentation UI
// and markdown export. Update this file when tools change.
//
// V3 architecture: 10 runtime tools across 8 phases. Discovery moved to
// background intelligence pipeline. Portfolio state injected as context.

// ── Enums ──────────────────────────────────────────────────────────────────

export type ToolStage =
  | "Discovery"
  | "Research"
  | "Decision"
  | "Execution"
  | "Synthesis";

export type ToolType =
  | "Aggregation"
  | "Retrieval"
  | "Lookup"
  | "Action"
  | "Logging";

export type ResourceType = "api" | "website" | "db" | "internal";

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface Resource {
  /** Provider key matching SourceChip PROVIDER_META (finnhub, fmp, reddit, etc.) */
  source: string;
  title: string;
  description: string;
  type: ResourceType;
  /** Endpoint path, function name, or URL */
  endpointOrPath: string;
  /** Human-readable example output — NOT raw JSON */
  exampleOutput?: string;
  notes?: string[];
}

export interface ToolDef {
  name: string;
  /** V2 alias — if this tool was renamed, the old name is here */
  alias?: string;
  stage: ToolStage;
  type: ToolType;
  summary: string;
  goal: string;
  /** V2 phase number(s) where this tool is called */
  phases: number[];
  tags?: string[];
  /** Provider keys for source logos in card header */
  sources: string[];
  resources: Resource[];
  /** V3: tool has been removed from runtime and replaced by the intelligence pipeline */
  deprecated?: boolean;
  /** V3: what replaced this tool */
  replacedBy?: string;
}

// ── Stage + Type metadata ──────────────────────────────────────────────────

export const STAGE_META: Record<ToolStage, { label: string; summary: string }> = {
  Discovery: {
    label: "Discovery",
    summary: "The analyst starts every session by reading pre-gathered intelligence — a morning brief with market context, portfolio alerts, and new opportunities, plus routed signals from background discovery jobs. It can also check live market conditions (SPY, VIX, sector ETFs) if the brief is stale.",
  },
  Research: {
    label: "Research",
    summary: "Deep-dive tools for individual stocks. The analyst pulls fundamentals, technicals, Wall Street ratings, options flow, earnings data, and SEC filings. These are called per-ticker for every stock the analyst is evaluating — existing holdings, watchlist items, and new candidates.",
  },
  Decision: {
    label: "Decision",
    summary: "After researching a stock, the analyst must record its verdict — LONG, SHORT, or PASS — with a confidence score, price targets, and reasoning. Every researched ticker gets a thesis, including passes, so we can track whether passing was the right call.",
  },
  Execution: {
    label: "Execution",
    summary: "Where decisions turn into action. The analyst places paper trades through the simulated brokerage, closes positions that have hit their target or stop-loss, and manages a watchlist of stocks to monitor for future sessions.",
  },
  Synthesis: {
    label: "Synthesis",
    summary: "The final step of every session. The analyst wraps up with a summary of ranked picks, market assessment, and risk notes. After the session ends, a separate briefing agent reviews the full conversation and writes the standup memo that feeds into the next run.",
  },
};

export const TYPE_META: Record<ToolType, { label: string }> = {
  Aggregation: { label: "Aggregation" },
  Retrieval: { label: "Retrieval" },
  Lookup: { label: "Lookup" },
  Action: { label: "Action" },
  Logging: { label: "Logging" },
};

// ── All tools (V3) ────────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  // ─── Discovery (Intelligence) ──────────────────────────────────────────
  {
    name: "read_morning_brief",
    stage: "Discovery",
    type: "Retrieval",
    summary: "Read today's pre-generated intelligence brief — market context, portfolio alerts, watchlist updates, new opportunities, and risk flags",
    goal: "Understand what happened overnight before making any research decisions. Background jobs gather this intelligence automatically, so the analyst doesn't have to rediscover it.",
    phases: [1],
    tags: ["required", "start-here"],
    sources: ["internal"],
    resources: [
      {
        source: "internal",
        title: "Morning brief",
        description: "A pre-generated intelligence brief created by background jobs before the analyst's session. Contains market context, alerts on open positions, updates on watchlist items, new opportunities matched to the analyst's mandate, and risk flags.",
        type: "db",
        endpointOrPath: "prisma.morningBrief.findUnique()",
        exampleOutput: "Market: SPY +0.5%, RISK_ON · 2 portfolio alerts (NVDA near target, AMD earnings this week) · 3 new opportunities",
      },
    ],
  },
  {
    name: "read_signals",
    stage: "Discovery",
    type: "Retrieval",
    summary: "Read intelligence signals routed by background discovery jobs — news, filings, earnings, macro, and sector signals matched to the analyst's mandate",
    goal: "Surface pre-gathered signals that the intelligence pipeline found relevant for this analyst. Replaces the old scan_candidates approach of rediscovering from scratch every run.",
    phases: [1],
    tags: ["required"],
    sources: ["internal"],
    resources: [
      {
        source: "internal",
        title: "Routed signals",
        description: "Findings gathered by background monitors (search, domain, ticker, and API monitors) and routed to this analyst based on sector overlap, watchlist tickers, and thematic relevance. Filtered by intelligence policy (urgency floor, quality floor, signal budget).",
        type: "db",
        endpointOrPath: "prisma.analystSignalRoute.findMany()",
        exampleOutput: "12 signals · 3 HIGH urgency · Topics: NVDA earnings beat, AMD guidance raise, semiconductor sector rotation",
      },
    ],
  },
  {
    name: "read_artifact",
    stage: "Discovery",
    type: "Retrieval",
    summary: "Read the full extracted content of an article or document behind a signal — the complete text, not just the headline",
    goal: "When a signal's headline is interesting, read the full source article to get complete context before making research decisions.",
    phases: [1, 2, 3, 4],
    tags: ["optional"],
    sources: ["internal"],
    resources: [
      {
        source: "internal",
        title: "Extracted article",
        description: "Full article content extracted by Firecrawl from the source URL. Stored as an Artifact and linked to the signal. Capped at 4000 chars to avoid token bloat.",
        type: "db",
        endpointOrPath: "prisma.artifact.findUnique()",
        exampleOutput: "\"NVIDIA Announces Next-Gen Blackwell GPUs\" — 2500 words extracted from Reuters article with full analysis",
      },
    ],
  },
  {
    name: "get_market_context",
    stage: "Discovery",
    type: "Aggregation",
    summary: "Quick price snapshot of the broad market — SPY, VIX, sector ETFs, macro events, and regime classification",
    goal: "Understand whether it's a risk-on or risk-off environment so the analyst can adjust its strategy accordingly. Morning brief handles themes and narratives.",
    phases: [1],
    tags: ["required", "start-here"],
    sources: ["finnhub", "fmp"],
    resources: [
      {
        source: "finnhub",
        title: "Index & sector quotes",
        description: "Checks the S&P 500, VIX (fear gauge), and all 11 sector ETFs to see which parts of the market are leading or lagging today. This tells the analyst where money is flowing.",
        type: "api",
        endpointOrPath: "/quote?symbol=SPY,^VIX,XLK,...",
        exampleOutput: "SPY $542.31 +0.8% · VIX 14.2 · XLK +1.2% (leading) · XLE -0.4% (lagging)",
        notes: ["13 quotes in a single batch — SPY, VIX, plus 11 sector ETFs"],
      },
      {
        source: "finnhub",
        title: "Broad market trend",
        description: "Pulls the last 30 days of S&P 500 price data to determine if the market is trending up or down. If SPY is above its 20-day average, the analyst treats it as an uptrend.",
        type: "api",
        endpointOrPath: "/stock/candle?symbol=SPY&resolution=D",
        exampleOutput: "SPY above SMA-20 ($538.50) → uptrend confirmed",
      },
      {
        source: "finnhub",
        title: "Earnings density",
        description: "Counts how many companies are reporting earnings this week. When lots of companies are reporting, there are more catalysts and more volatility — the analyst adjusts its aggressiveness.",
        type: "api",
        endpointOrPath: "/calendar/earnings",
        exampleOutput: "47 companies reporting this week — elevated earnings density",
      },
      {
        source: "fmp",
        title: "Economic calendar",
        description: "Checks for major macro events today — Fed meetings, CPI data, jobs reports. High-impact events can move the entire market, so the analyst factors them into risk decisions.",
        type: "api",
        endpointOrPath: "/economic_calendar",
        exampleOutput: "CPI release 8:30 AM (high impact) · No FOMC this week",
      },
      {
        source: "internal",
        title: "Market regime",
        description: "Combines VIX level and market trend into a simple classification — RISK_ON, RISK_OFF, or NEUTRAL. This determines how aggressive the analyst will be with new positions during discovery.",
        type: "internal",
        endpointOrPath: "inline logic",
        exampleOutput: "RISK_ON — VIX < 20, SPY above SMA-20",
      },
    ],
  },
  // ─── Research ─────────────────────────────────────────────────────────
  {
    name: "get_stock_data",
    stage: "Research",
    type: "Aggregation",
    summary: "The analyst's main research tool — pulls everything about a stock in one call: price, company info, valuation, technicals, Wall Street ratings, and recent headlines",
    goal: "Give the analyst a complete picture of any ticker so it can form a thesis",
    phases: [2, 3, 4],
    tags: ["required", "per-ticker"],
    sources: ["finnhub", "fmp"],
    resources: [
      {
        source: "finnhub",
        title: "Live price",
        description: "Current stock price, today's change, and the day's trading range. The starting point for any analysis.",
        type: "api",
        endpointOrPath: "/quote?symbol={ticker}",
        exampleOutput: "NVDA $134.23 +2.1% · Day range $131.80–$135.10",
      },
      {
        source: "finnhub",
        title: "Company profile",
        description: "Who is this company? Name, sector, market cap, exchange, country. The analyst uses this to check sector fit and market cap tier against its strategy rules.",
        type: "api",
        endpointOrPath: "/stock/profile2?symbol={ticker}",
        exampleOutput: "NVIDIA Corp · Technology · $3.3T market cap · NASDAQ",
      },
      {
        source: "finnhub",
        title: "Key financials",
        description: "Valuation ratios (P/E, P/B), risk metrics (beta), 52-week range, EPS, and average trading volume. The analyst checks whether the stock is cheap or expensive relative to its history.",
        type: "api",
        endpointOrPath: "/stock/metric?symbol={ticker}&metric=all",
        exampleOutput: "P/E 65.2 · Beta 1.68 · 52W range $75.61–$153.13",
      },
      {
        source: "finnhub",
        title: "Recent headlines",
        description: "The 5 most recent news articles about this company. The analyst looks for catalysts, risks, or narrative shifts that could move the stock.",
        type: "api",
        endpointOrPath: "/company-news?symbol={ticker}",
        exampleOutput: "\"NVIDIA Announces Next-Gen Blackwell GPUs\" — Reuters, 2h ago",
      },
      {
        source: "finnhub",
        title: "Wall Street consensus",
        description: "How many analysts rate it Buy, Hold, or Sell. A strong consensus can confirm the thesis or signal a crowded trade.",
        type: "api",
        endpointOrPath: "/stock/recommendation?symbol={ticker}",
        exampleOutput: "Strong Buy: 38 · Buy: 6 · Hold: 3 · Sell: 0",
      },
      {
        source: "finnhub",
        title: "Technical setup",
        description: "Calculates momentum (RSI), trend (moving averages), volume activity, and where the price sits in its 52-week range. The analyst uses this to time entries and judge whether a move has legs.",
        type: "api",
        endpointOrPath: "/stock/candle?symbol={ticker}&resolution=D",
        exampleOutput: "RSI 58.3 · Above SMA-20 ($129.40) · Volume 1.3x average · Uptrend",
        notes: ["Uses 60 days of daily price data", "Falls back to FMP or Alpaca if Finnhub data is unavailable"],
      },
      {
        source: "fmp",
        title: "Price targets",
        description: "What Wall Street analysts think the stock is worth — average, high, low, and how many analysts are covering it. The analyst compares this to its own thesis target.",
        type: "api",
        endpointOrPath: "/v4/price-target-consensus?symbol={ticker}",
        exampleOutput: "Average target $158.00 · High $200 · Low $120 · 44 analysts",
      },
    ],
  },
  {
    name: "get_options_flow",
    stage: "Research",
    type: "Retrieval",
    summary: "Looks at options market activity to see if big players are making directional bets — like reading the smart money's hand",
    goal: "Detect institutional positioning through unusual options activity, put/call ratios, and implied volatility",
    phases: [2, 3, 4],
    tags: ["optional", "per-ticker"],
    sources: ["fmp", "finnhub"],
    resources: [
      {
        source: "fmp",
        title: "Options chain analysis",
        description: "Pulls the full options chain and analyzes it for unusual activity — contracts where volume far exceeds open interest, or where premium size suggests institutional bets. A put/call ratio below 0.7 is bullish; above 1.0 is bearish.",
        type: "api",
        endpointOrPath: "/options/chain/{ticker}",
        exampleOutput: "P/C ratio 0.65 (bullish) · 3 unusual contracts detected",
        notes: ["Flags contracts where volume/OI ≥ 5x or premium ≥ $500K"],
      },
      {
        source: "finnhub",
        title: "Options chain (backup)",
        description: "Same analysis using Finnhub as a backup data source if the primary options data is unavailable for this ticker.",
        type: "api",
        endpointOrPath: "/stock/option-chain?symbol={ticker}",
      },
    ],
  },
  {
    name: "get_earnings_data",
    stage: "Research",
    type: "Retrieval",
    summary: "Checks when a company reports earnings next and how reliably it beats expectations — critical for timing entries and exits",
    goal: "Help the analyst decide whether to trade ahead of earnings, wait, or avoid the stock entirely",
    phases: [2, 3, 4],
    tags: ["optional", "per-ticker"],
    sources: ["finnhub"],
    resources: [
      {
        source: "finnhub",
        title: "Next report date",
        description: "When is the next earnings report? Is it before or after market close? What are Wall Street's EPS and revenue estimates? The analyst uses this to assess catalyst timing and risk.",
        type: "api",
        endpointOrPath: "/calendar/earnings?symbol={ticker}",
        exampleOutput: "Reports Mar 26 AMC · EPS est. $0.84 · Rev est. $38.2B",
      },
      {
        source: "finnhub",
        title: "Track record",
        description: "How often does this company beat or miss estimates? Last 8 quarters of actual vs. expected EPS. A consistent beater at 87%+ gives the analyst more confidence in an earnings play.",
        type: "api",
        endpointOrPath: "/stock/earnings?symbol={ticker}&limit=8",
        exampleOutput: "Beat rate: 87.5% (7/8) · Last Q: $0.89 vs $0.84 est (+5.9%)",
      },
    ],
  },
  {
    name: "get_sec_filings",
    stage: "Research",
    type: "Lookup",
    summary: "Checks SEC filings for insider buying/selling, material events, and regulatory disclosures — things that don't show up in price data yet",
    goal: "Catch red flags (insider dumps, 8-K material events) or bullish signals (insider purchases, buyback filings) before the market prices them in",
    phases: [2, 3, 4],
    tags: ["optional", "per-ticker"],
    sources: ["sec"],
    resources: [
      {
        source: "sec",
        title: "Company lookup",
        description: "Finds the company's SEC identifier so we can pull their filings. Every public company has a unique CIK number on file with the SEC.",
        type: "api",
        endpointOrPath: "sec.gov/files/company_tickers.json",
        exampleOutput: "NVDA → CIK 0001045810",
      },
      {
        source: "sec",
        title: "Recent filings",
        description: "Pulls the last 8 SEC filings — annual reports (10-K), quarterly reports (10-Q), material events (8-K), and insider transaction reports (Form 4). The analyst looks for insider selling patterns, material disclosures, or new risk factors.",
        type: "api",
        endpointOrPath: "data.sec.gov/submissions/CIK{cik}.json",
        exampleOutput: "8-K filed Mar 15 — Material event · Form 4 — Insider sale 50K shares",
      },
    ],
  },
  // ─── Decision ─────────────────────────────────────────────────────────
  {
    name: "record_thesis",
    stage: "Decision",
    type: "Action",
    summary: "The analyst writes up its verdict on a stock — LONG, SHORT, or PASS — with confidence level, price targets, risk flags, and full reasoning",
    goal: "Document the analyst's thinking for every stock it researches. Required even for stocks it decides to pass on, so we can track whether passing was the right call.",
    phases: [2, 3, 4, 6],
    tags: ["required", "per-ticker"],
    sources: ["internal"],
    resources: [
      {
        source: "internal",
        title: "Save thesis",
        description: "Records the analyst's full analysis: direction (LONG/SHORT/PASS), confidence score, entry/target/stop prices, bullet-point reasoning, risk flags, and supporting data. If this is an update to a previous thesis, it links to the original to track how the view evolved.",
        type: "db",
        endpointOrPath: "prisma.thesis.create()",
        exampleOutput: "NVDA LONG 78% · Entry $134 · Target $158 · Stop $122 · 4 bullets, 2 risk flags",
      },
      {
        source: "internal",
        title: "Show in timeline",
        description: "Makes the thesis visible in the run's timeline so you can see it when reviewing the session later. Without this, the thesis would be saved but invisible in the UI.",
        type: "db",
        endpointOrPath: "prisma.runEvent.create()",
        exampleOutput: "Thesis card appears in the run timeline for NVDA",
      },
      {
        source: "internal",
        title: "Track pass decisions",
        description: "When the analyst passes on a stock, we record the decision with the stock's price at that moment. Later, we check if the stock went up — this is how we measure whether the analyst is too conservative or too aggressive with its passes.",
        type: "db",
        endpointOrPath: "prisma.tradeDecision.create({ PASS })",
        exampleOutput: "Passed on COIN at $245 — will track whether that was the right call",
        notes: ["Only for PASS decisions, not LONG/SHORT"],
      },
    ],
  },

  // ─── Execution ────────────────────────────────────────────────────────
  {
    name: "place_trade",
    stage: "Execution",
    type: "Action",
    summary: "Executes a paper trade — buys or sells shares on the simulated brokerage account based on the analyst's thesis",
    goal: "Turn the analyst's conviction into an actual portfolio position that we can track and evaluate",
    phases: [6],
    tags: ["optional"],
    sources: ["alpaca", "internal"],
    resources: [
      {
        source: "alpaca",
        title: "Submit order",
        description: "Places a market buy or sell order on the Alpaca paper trading platform. The order executes at the current market price. Position size is calculated from the analyst's max position size setting.",
        type: "api",
        endpointOrPath: "placeMarketOrder({ symbol, qty, side })",
        exampleOutput: "BUY 74 shares NVDA @ market → Filled $134.23",
      },
      {
        source: "alpaca",
        title: "Confirm fill",
        description: "Waits up to 5 seconds for the order to fill and confirms the exact price we got. The analyst needs the fill price to set accurate target and stop-loss levels.",
        type: "api",
        endpointOrPath: "getOrder(orderId)",
        exampleOutput: "Status: FILLED · Avg fill: $134.23",
      },
      {
        source: "internal",
        title: "Record position",
        description: "Saves the new position to our portfolio tracker with entry price, share count, target, and stop-loss. Also logs the trade decision and checks if this stock was on the watchlist (if so, it graduates off the watchlist).",
        type: "db",
        endpointOrPath: "prisma.position.create()",
        exampleOutput: "Position opened: LONG 74 shares NVDA @ $134.23",
        notes: ["Blocks duplicate positions — can't buy a stock you already hold", "Watchlist items auto-graduate when traded"],
      },
    ],
  },
  {
    name: "close_position",
    stage: "Execution",
    type: "Action",
    summary: "Sells an existing position — either because the thesis played out (target hit), the thesis failed (stop hit), or the analyst wants to rebalance",
    goal: "Exit a position with a clear reason and calculate the realized P&L",
    phases: [6],
    tags: ["optional"],
    sources: ["alpaca", "internal"],
    resources: [
      {
        source: "internal",
        title: "Find the position",
        description: "Looks up the open position for this ticker in the analyst's portfolio — confirms it exists, how many shares we hold, and what our entry price was.",
        type: "db",
        endpointOrPath: "prisma.position.findFirst({ symbol, status: OPEN })",
        exampleOutput: "Found: AAPL LONG 50 shares @ $178.20 (target $195, stop $170)",
      },
      {
        source: "alpaca",
        title: "Sell all shares",
        description: "Submits a sell order for the entire position on Alpaca. The analyst gets the fill price, and we calculate the realized profit or loss.",
        type: "api",
        endpointOrPath: "closeOpenPosition(symbol)",
        exampleOutput: "Closed 50 shares AAPL @ $192.40 · Realized P&L +$710 (+7.9%)",
      },
      {
        source: "internal",
        title: "Record outcome",
        description: "Marks the position as closed with the exit price, P&L, and close reason (TARGET, STOP, or MANUAL). This is how we track win/loss rate and evaluate analyst performance over time.",
        type: "db",
        endpointOrPath: "prisma.tradeDecision.create({ SELL })",
        exampleOutput: "EXIT reason: TARGET · Outcome: WIN · +$710 realized",
      },
    ],
  },
  {
    name: "manage_watchlist",
    stage: "Execution",
    type: "Action",
    summary: "Saves interesting stocks for later — the analyst's \"come back to this\" list with priority levels, catalysts, and target prices",
    goal: "Track stocks the analyst wants to monitor but isn't ready to trade yet. High-priority items get reviewed first in the next session.",
    phases: [6],
    tags: ["optional"],
    sources: ["internal"],
    resources: [
      {
        source: "internal",
        title: "Update watchlist",
        description: "Adds a stock to the watchlist with a priority (HIGH/NORMAL/LOW), upcoming catalyst (e.g. \"Earnings Mar 28\"), conviction level, and target entry price. Or updates/removes an existing item if the thesis changed.",
        type: "db",
        endpointOrPath: "prisma.analystWatchlistItem.create/update()",
        exampleOutput: "Added AMD · Priority: HIGH · Catalyst: Earnings Mar 28 · Target: $180",
        notes: ["Adding a stock that's already on the list updates it instead of creating a duplicate"],
      },
      {
        source: "internal",
        title: "Log the change",
        description: "Records the watchlist change in the run's timeline so you can see when and why stocks were added, removed, or reprioritized.",
        type: "db",
        endpointOrPath: "prisma.runEvent.create()",
        exampleOutput: "Watchlist: added AMD (HIGH priority, earnings catalyst)",
      },
    ],
  },

  // ─── Synthesis ────────────────────────────────────────────────────────
  {
    name: "complete_run",
    stage: "Synthesis",
    type: "Logging",
    summary: "The analyst's final action — wraps up the session with a ranked pick list, market assessment, and risk notes",
    goal: "Close the session, save the ranked picks and summary, and record HOLD decisions. A separate briefing agent runs afterward to write the standup memo.",
    phases: [7],
    tags: ["required", "always-last"],
    sources: ["internal"],
    resources: [
      {
        source: "internal",
        title: "Close the session",
        description: "Marks the research session as complete so it shows up as finished (not still running) in the UI. Records total time elapsed and number of tool calls used.",
        type: "db",
        endpointOrPath: "prisma.researchRun.update({ COMPLETE })",
        exampleOutput: "Session complete — 27 tool steps in 84 seconds",
      },
      {
        source: "internal",
        title: "Save the summary",
        description: "Stores the analyst's final summary — ranked picks, market assessment, risk notes, exposure breakdown — so you can review what the analyst concluded when you look at this run later.",
        type: "db",
        endpointOrPath: "prisma.runEvent.create({ run_summary })",
        exampleOutput: "3 stocks researched, 1 traded, 1 passed · Net long exposure +$9,870",
      },
      {
        source: "internal",
        title: "Record HOLD decisions",
        description: "For positions the analyst reviewed but decided to keep unchanged, records a HOLD decision so we can track that the analyst actively chose to hold (not that it forgot).",
        type: "db",
        endpointOrPath: "prisma.tradeDecision.create({ HOLD })",
        exampleOutput: "HOLD: AMZN (thesis intact, within parameters) · NVDA (near target, watching closely)",
      },
    ],
  },
  // ─── Deprecated Tools (removed in V3, replaced by intelligence pipeline) ──
  {
    name: "scan_candidates",
    stage: "Discovery",
    type: "Aggregation",
    summary: "Scanned for trading candidates using market movers, social sentiment, and trending tickers",
    goal: "Find new stocks to research. Replaced by background intelligence jobs that gather candidates overnight.",
    phases: [],
    tags: ["removed"],
    sources: ["fmp", "stocktwits"],
    resources: [],
    deprecated: true,
    replacedBy: "read_signals — pre-gathered from FMP market movers, Finnhub earnings calendar, and Perplexity Sonar web search by background intelligence jobs",
  },
  {
    name: "get_social_sentiment",
    stage: "Discovery",
    type: "Retrieval",
    summary: "Checked social media sentiment from StockTwits and Reddit for a given ticker",
    goal: "Gauge retail sentiment. Replaced by social signals gathered by the intelligence pipeline.",
    phases: [],
    tags: ["removed"],
    sources: ["stocktwits", "reddit"],
    resources: [],
    deprecated: true,
    replacedBy: "read_signals — social sentiment is now gathered as SOCIAL-type signals by background jobs and routed to relevant analysts",
  },
  {
    name: "search_reddit",
    stage: "Discovery",
    type: "Retrieval",
    summary: "Searched Reddit (r/wallstreetbets, r/stocks) for discussion about a ticker",
    goal: "Find retail catalysts and sentiment. Replaced by intelligence pipeline's web search.",
    phases: [],
    tags: ["removed"],
    sources: ["reddit"],
    resources: [],
    deprecated: true,
    replacedBy: "read_signals + read_artifact — Perplexity Sonar searches include Reddit and social media. Relevant discussions surface as signals with full article extraction available.",
  },
];

// ── V3 Run Contract (8 phases) ─────────────────────────────────────────

export interface RunPhase {
  number: number;
  name: string;
  description: string;
  tools: string[];
  stepBudget: string;
}

export const RUN_PHASES: RunPhase[] = [
  { number: 0, name: "Portfolio Check-in", description: "Read injected context: holdings, watchlist, prior brief, performance stats. No tool calls — pure reasoning.", tools: [], stepBudget: "0 steps" },
  { number: 1, name: "Read Intelligence", description: "Read pre-gathered intelligence: morning brief (market context, portfolio alerts, new opportunities) and routed signals. Optionally call get_market_context if brief is stale.", tools: ["read_morning_brief", "read_signals", "read_artifact", "get_market_context"], stepBudget: "1–3 steps" },
  { number: 2, name: "Review Holdings", description: "Triage open positions near target/stop, with earnings, or from watch-tomorrow list.", tools: ["get_stock_data", "get_earnings_data", "get_options_flow", "record_thesis"], stepBudget: "1–6 steps" },
  { number: 3, name: "Review Watchlist", description: "Triage watchlist items by priority, review triggers and catalysts.", tools: ["get_stock_data", "record_thesis"], stepBudget: "1–4 steps" },
  { number: 4, name: "Discover", description: "Review opportunities from intelligence signals and morning brief. Research new ideas. Reduced scope at max positions or RISK_OFF.", tools: ["get_stock_data", "get_options_flow", "get_earnings_data", "get_sec_filings", "record_thesis"], stepBudget: "2–8 steps" },
  { number: 5, name: "Synthesize", description: "Pure reasoning. Output decision table: INITIATE, ADD, HOLD, REDUCE, EXIT, WATCH, REMOVE, PASS. Consider exposure, risk budget, conflicts.", tools: [], stepBudget: "0 steps" },
  { number: 6, name: "Execute", description: "Execute decisions in order (exits before entries). Place trades, close positions, manage watchlist.", tools: ["place_trade", "close_position", "manage_watchlist"], stepBudget: "1–5 steps" },
  { number: 7, name: "Wrap Up", description: "Call complete_run with ranked picks, market summary, overall assessment, exposure breakdown, and risk notes. The analyst does NOT self-reflect — a separate briefing agent handles that after the session.", tools: ["complete_run"], stepBudget: "1 step" },
];

// ── Context model (not a tool, but part of the run) ────────────────────

export interface ContextSection {
  name: string;
  description: string;
  source: string;
}

export const INJECTED_CONTEXT: ContextSection[] = [
  { name: "Portfolio snapshot", description: "Open positions with live P&L, days held, active thesis summary, long/short/net exposure, utilization %", source: "internal + alpaca" },
  { name: "Watchlist", description: "Active items with priority, thesis direction, target price, conviction, catalyst, days on list", source: "internal" },
  { name: "Active theses", description: "Most recent thesis per ticker for open positions and watchlist symbols", source: "internal" },
  { name: "Prior brief", description: "Latest analyst briefing from the post-run briefing agent: narrative, market posture, watchTomorrow, unresolvedItems, selfCorrections. Written by GPT-4o reviewing the full research conversation — not self-reported by the analyst.", source: "internal (briefing agent)" },
  { name: "Performance stats", description: "Latest AccuracyReport: win rate, total trades, calibration note", source: "internal" },
  { name: "Recent closed trades", description: "Last 10 closed positions: outcome, P&L %, days held, lesson learned", source: "internal" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

export const STAGES: ToolStage[] = ["Discovery", "Research", "Decision", "Execution", "Synthesis"];

export function getToolsByStage(stage: ToolStage): ToolDef[] {
  return TOOLS.filter((t) => t.stage === stage);
}

export function getToolsByPhase(phase: number): ToolDef[] {
  return TOOLS.filter((t) => t.phases.includes(phase));
}

// ── Markdown export ────────────────────────────────────────────────────────

export function exportToolsAsMarkdown(): string {
  const lines: string[] = [
    "# Agent Tool Registry",
    "",
    `${TOOLS.length} tools · ${RUN_PHASES.length} phases · V3 intelligence-first architecture`,
    "",
    "## Run Contract (8 phases)",
    "",
  ];

  for (const phase of RUN_PHASES) {
    lines.push(`### Phase ${phase.number}: ${phase.name} (${phase.stepBudget})`);
    lines.push(phase.description);
    if (phase.tools.length > 0) {
      lines.push(`Tools: ${phase.tools.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Injected Context (loaded before Phase 0)");
  lines.push("");
  for (const ctx of INJECTED_CONTEXT) {
    lines.push(`- **${ctx.name}** (${ctx.source}): ${ctx.description}`);
  }
  lines.push("");

  lines.push("## Tools by Stage");
  lines.push("");

  for (const stage of STAGES) {
    const tools = getToolsByStage(stage);
    if (tools.length === 0) continue;

    lines.push(`### ${stage}`);
    lines.push("");

    for (const tool of tools) {
      lines.push(`#### ${tool.name}${tool.alias ? ` (alias: ${tool.alias})` : ""}`);
      lines.push(`- Stage: ${tool.stage}`);
      lines.push(`- Type: ${tool.type}`);
      lines.push(`- Phases: ${tool.phases.join(", ")}`);
      lines.push(`- Summary: ${tool.summary}`);
      lines.push(`- Goal: ${tool.goal}`);
      if (tool.sources.length > 0) {
        lines.push(`- Sources: ${tool.sources.join(", ")}`);
      }
      if (tool.tags && tool.tags.length > 0) {
        lines.push(`- Tags: ${tool.tags.join(", ")}`);
      }
      lines.push("");
      lines.push("**Resources:**");
      for (const r of tool.resources) {
        lines.push(`- ${r.title} (${r.source}, ${r.type}) — ${r.description}`);
        lines.push(`  Endpoint: \`${r.endpointOrPath}\``);
        if (r.exampleOutput) {
          lines.push(`  Example: ${r.exampleOutput}`);
        }
        if (r.notes?.length) {
          for (const note of r.notes) {
            lines.push(`  Note: ${note}`);
          }
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
