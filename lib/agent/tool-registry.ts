// ── Tool Registry ──────────────────────────────────────────────────────────
// Structured data for all agent tools. Drives the tool documentation UI
// and markdown export. Update this file when tools change.
//
// V2 architecture: 13 tools across 8 phases. Portfolio state is injected
// as context (not a tool). show_thesis → record_thesis, summarize_run → complete_run.

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
}

// ── Stage + Type metadata ──────────────────────────────────────────────────

export const STAGE_META: Record<ToolStage, { label: string; summary: string }> = {
  Discovery: {
    label: "Discovery",
    summary: "The analyst starts every session here. It reads the overall market environment — which sectors are hot, whether the VIX is elevated, what macro events are on deck — then scans 6 different sources to build a ranked shortlist of stocks worth researching today.",
  },
  Research: {
    label: "Research",
    summary: "Deep-dive tools for individual stocks. The analyst pulls fundamentals, technicals, Wall Street ratings, social sentiment, options flow, earnings data, and SEC filings. These are called per-ticker for every stock the analyst is evaluating — existing holdings, watchlist items, and new candidates.",
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

// ── All tools (V2) ────────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  // ─── Discovery ────────────────────────────────────────────────────────
  {
    name: "get_market_context",
    stage: "Discovery",
    type: "Aggregation",
    summary: "Reads the full market landscape before looking at any individual stock — like checking the weather before planning your day",
    goal: "Understand whether it's a risk-on or risk-off environment so the analyst can adjust its strategy accordingly",
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
        source: "finnhub",
        title: "Market narratives",
        description: "Scans 50 recent headlines to detect the dominant themes driving the market right now (AI, rate cuts, trade war, etc.). The analyst uses these themes to contextualize individual stock moves.",
        type: "api",
        endpointOrPath: "/news?category=general",
        exampleOutput: "Themes: AI Infrastructure (strong, bullish), Rate Cut Expectations (moderate, bullish)",
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
  {
    name: "scan_candidates",
    stage: "Discovery",
    type: "Aggregation",
    summary: "Casts a wide net across 6 sources to find stocks worth researching today, then ranks them by conviction",
    goal: "Build a shortlist of 5–15 stocks the analyst should deep-dive into, prioritizing watchlist items and multi-source signals",
    phases: [4],
    tags: ["required"],
    sources: ["finnhub", "fmp", "stocktwits", "reddit"],
    resources: [
      {
        source: "finnhub",
        title: "Upcoming earnings",
        description: "Finds companies reporting earnings in the next 30 days. Earnings are one of the strongest catalysts — the analyst looks for pre-earnings setups and avoids getting blindsided.",
        type: "api",
        endpointOrPath: "/calendar/earnings",
        exampleOutput: "NVDA earnings Mar 26 · ORCL earnings Mar 28",
        notes: ["Returns 50-200 companies depending on earnings season"],
      },
      {
        source: "fmp",
        title: "Today's biggest gainers",
        description: "The top 20 stocks moving up the most today. Momentum breakouts and sector rotation signals often show up here first. The analyst looks for names with real catalysts, not just noise.",
        type: "api",
        endpointOrPath: "/stock_market/gainers",
        exampleOutput: "SMCI +12.4% · PLTR +5.1% · COIN +4.8%",
        notes: ["Returns ~20 stocks", "OTC and penny stocks are filtered out"],
      },
      {
        source: "fmp",
        title: "Today's biggest losers",
        description: "The top 20 stocks falling the most today. The analyst watches for overreactions to earnings misses, downgrades, or sector weakness — potential mean-reversion opportunities.",
        type: "api",
        endpointOrPath: "/stock_market/losers",
        exampleOutput: "NKE -8.2% · FDX -4.1%",
        notes: ["Returns ~20 stocks"],
      },
      {
        source: "fmp",
        title: "Most actively traded",
        description: "The 20 highest-volume stocks today by dollar amount. Unusual volume often means institutional money is moving — the analyst uses this to spot under-the-radar activity.",
        type: "api",
        endpointOrPath: "/stock_market/actives",
        exampleOutput: "TSLA 82M shares · NVDA 61M shares",
        notes: ["Returns ~20 stocks", "Ranked by dollar volume, not share count"],
      },
      {
        source: "stocktwits",
        title: "Trending on StockTwits",
        description: "Which tickers retail traders on StockTwits are talking about most right now. Social momentum can precede price moves — or signal a crowded trade to avoid.",
        type: "api",
        endpointOrPath: "/api/2/trending/symbols.json",
        exampleOutput: "Trending: $NVDA, $SMCI, $PLTR, $COIN",
      },
      {
        source: "reddit",
        title: "Reddit buzz",
        description: "Scans r/wallstreetbets, r/stocks, r/options, and r/investing for which tickers are getting the most mentions and upvotes right now.",
        type: "api",
        endpointOrPath: "discoverTrendingTickers()",
        exampleOutput: "Reddit buzz: NVDA (42 mentions), GME (18 mentions)",
      },
      {
        source: "internal",
        title: "Scoring & ranking",
        description: "Combines all 6 sources into one ranked list. Stocks appearing in multiple sources score higher. Watchlist items get a priority boost. Result: a shortlist of 5-15 candidates the analyst will actually research.",
        type: "internal",
        endpointOrPath: "score + rank pipeline",
        exampleOutput: "15 candidates — NVDA (score: 8, 4 sources), PLTR (score: 5, 2 sources)",
        notes: ["Capped at 15 to preserve the step budget for deep research"],
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
    name: "get_social_sentiment",
    stage: "Research",
    type: "Aggregation",
    summary: "Checks what retail traders on Reddit and StockTwits are saying about a specific stock — bullish, bearish, or indifferent",
    goal: "Gauge crowd sentiment as an additional signal. High retail bullishness can mean momentum or a crowded trade — the analyst interprets in context.",
    phases: [2, 3, 4],
    tags: ["optional", "per-ticker"],
    sources: ["reddit", "stocktwits", "fmp"],
    resources: [
      {
        source: "reddit",
        title: "Reddit sentiment",
        description: "Searches 4 trading subreddits for mentions of this stock — how many people are talking about it, whether they're bullish or bearish, and what the top posts say.",
        type: "api",
        endpointOrPath: "getRedditSentiment({ticker})",
        exampleOutput: "NVDA: 42 mentions · Bullish (0.72) · Top post: \"NVDA earnings play\" (+340 upvotes)",
      },
      {
        source: "stocktwits",
        title: "StockTwits sentiment",
        description: "Checks FinTwit for this stock's bullish/bearish ratio, how many traders are watching it, and the volume of recent messages. High watcher count with bullish skew can signal retail conviction.",
        type: "api",
        endpointOrPath: "/api/2/streams/symbol/{ticker}.json",
        exampleOutput: "68% bullish · 12.4K watchers · 89 messages today",
      },
      {
        source: "fmp",
        title: "Sentiment trend",
        description: "Historical social mention volume for this stock — is buzz increasing or fading compared to last week? Rising mentions before earnings can signal a potential catalyst play.",
        type: "api",
        endpointOrPath: "/v4/historical/social-sentiment?symbol={ticker}",
        exampleOutput: "Sentiment trending up +15% vs last week",
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
  {
    name: "search_reddit",
    stage: "Research",
    type: "Lookup",
    summary: "Searches trading communities on Reddit for broader themes — not just ticker-specific sentiment, but sector narratives, trade ideas, and emerging catalysts",
    goal: "Discover what retail traders are thinking about a sector, theme, or catalyst before it becomes mainstream news",
    phases: [2, 3, 4],
    tags: ["optional"],
    sources: ["reddit"],
    resources: [
      {
        source: "reddit",
        title: "Reddit search",
        description: "Keyword search across r/wallstreetbets, r/stocks, r/options, and r/investing. Returns the most upvoted posts matching the query. The analyst uses this for thematic research — like searching \"biotech FDA\" to find upcoming catalysts.",
        type: "website",
        endpointOrPath: "searchReddit({query}, subreddits)",
        exampleOutput: "\"Biotech FDA approvals\" → 12 posts · Top: \"MRNA FDA decision timeline\" (+280)",
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
];

// ── V2 Run Contract (8 phases) ─────────────────────────────────────────

export interface RunPhase {
  number: number;
  name: string;
  description: string;
  tools: string[];
  stepBudget: string;
}

export const RUN_PHASES: RunPhase[] = [
  { number: 0, name: "Portfolio Check-in", description: "Read injected context: holdings, watchlist, prior brief, performance stats. No tool calls — pure reasoning.", tools: [], stepBudget: "0 steps" },
  { number: 1, name: "Orient", description: "Market context: SPY, VIX, sectors, macro events, regime classification, themes.", tools: ["get_market_context"], stepBudget: "1 step" },
  { number: 2, name: "Review Holdings", description: "Triage open positions near target/stop, with earnings, or from watch-tomorrow list.", tools: ["get_stock_data", "get_earnings_data", "get_options_flow", "record_thesis"], stepBudget: "1–6 steps" },
  { number: 3, name: "Review Watchlist", description: "Triage watchlist items by priority, review triggers and catalysts.", tools: ["get_stock_data", "get_social_sentiment", "record_thesis"], stepBudget: "1–4 steps" },
  { number: 4, name: "Discover", description: "Scan candidates from earnings, movers, social buzz. Research new opportunities. Reduced scope at max positions or RISK_OFF.", tools: ["scan_candidates", "get_stock_data", "get_social_sentiment", "get_options_flow", "get_earnings_data", "get_sec_filings", "search_reddit", "record_thesis"], stepBudget: "2–8 steps" },
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
    `${TOOLS.length} tools · ${RUN_PHASES.length} phases · V2 portfolio-manager architecture`,
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
