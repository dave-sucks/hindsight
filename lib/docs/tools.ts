/**
 * The plain-words layer of the /docs tool catalog: each tool's name, kind,
 * sources and summary, and the agents the page filters by. Client-safe: it
 * imports no agent code. Which agent has which tool is read from the modes on
 * the server (./tool-catalog.ts).
 */

import type { AgentMode } from "@/lib/agent/modes";

export type DocsAgentId = "morning" | "trigger" | "chat" | "discovery" | "writer" | "builder";
export type ToolKind = "market" | "book" | "thesis" | "trade" | "run";
export type ToolSource = "alpaca" | "finnhub" | "sec" | "perplexity" | "anthropic" | "xai" | "hindsight" | "inngest";

export interface DocsAgent {
  id: DocsAgentId;
  name: string;
  /** The modes whose allowlists make up this agent. */
  modes: readonly AgentMode[];
}

export const DOCS_AGENTS: readonly DocsAgent[] = [
  { id: "morning", name: "Morning run", modes: ["research-run"] },
  { id: "trigger", name: "Trigger run", modes: ["tactical"] },
  { id: "chat", name: "Chat", modes: ["principal"] },
  { id: "discovery", name: "Discovery", modes: ["discovery"] },
  { id: "writer", name: "Writer", modes: [] },
  { id: "builder", name: "Analyst builder", modes: ["builder", "editor"] },
];

/**
 * The Writer's tools. Its mode has no allowlist: the data tools are pulled in
 * code before it writes (lib/agent/thesis-research/pull-data.ts), then one
 * research call uses Claude's own web search and ends with submit_thesis
 * (lib/agent/run-thesis-writer.ts).
 */
export const WRITER_TOOLS: readonly string[] = [
  "get_stock_data",
  "get_earnings_history",
  "get_financials_deep",
  "get_insider_activity",
  "get_peers_with_metrics",
  "get_analyst_coverage",
  "get_sec_filings",
  "web_search",
  "submit_thesis",
];

export const TOOL_KINDS: readonly { id: ToolKind; name: string; short: string }[] = [
  { id: "market", name: "Market & research", short: "Market data" },
  { id: "book", name: "Your book", short: "Your book" },
  { id: "thesis", name: "Changing a thesis", short: "Thesis edits" },
  { id: "trade", name: "Trades", short: "Trades" },
  { id: "run", name: "Running the run", short: "Run steps" },
];

export const TOOL_SOURCES: Record<ToolSource, string> = {
  alpaca: "Alpaca",
  finnhub: "Finnhub",
  sec: "SEC EDGAR",
  perplexity: "Perplexity",
  anthropic: "Anthropic",
  xai: "X via Grok",
  hindsight: "Hindsight",
  inngest: "Inngest",
};

export interface ToolResource {
  source: ToolSource;
  title: string;
  description: string;
  endpoint: string;
  example?: string;
}

export interface ToolDoc {
  name: string;
  kind: ToolKind;
  sources: readonly ToolSource[];
  summary: string;
  /** A trade: it becomes a proposal that waits for your approval. */
  approval?: boolean;
  resources?: readonly ToolResource[];
  notes?: readonly string[];
}

export interface CatalogTool extends ToolDoc {
  code: string;
  agents: DocsAgentId[];
}

export const TOOL_DOCS: Record<string, ToolDoc> = {
  // ── Market & research ────────────────────────────────────────────────
  get_stock_data: {
    name: "Stock data",
    kind: "market",
    sources: ["alpaca", "finnhub"],
    summary: "Live price, company profile, key financials, technicals, analyst ratings and recent news for one stock.",
    resources: [
      { source: "alpaca", title: "Live price", description: "The current price with the time it printed, the change and the day's range.", endpoint: "/v2/stocks/snapshots?symbols={ticker}", example: "NVDA $134.23 +2.1%" },
      { source: "finnhub", title: "Company profile", description: "Name, sector, market cap, exchange.", endpoint: "/stock/profile2?symbol={ticker}", example: "NVIDIA Corp · Technology · $3.3T" },
      { source: "finnhub", title: "Key financials", description: "P/E, P/B, beta, 52-week range, EPS.", endpoint: "/stock/metric?symbol={ticker}&metric=all", example: "P/E 65.2 · Beta 1.68 · 52W $75–$153" },
      { source: "alpaca", title: "Technical setup", description: "RSI, moving averages, volume and trend from daily bars.", endpoint: "/v2/stocks/bars?symbols={ticker}&timeframe=1Day", example: "RSI 58 · Above the 20-day · Volume 1.3x average" },
      { source: "finnhub", title: "Recent headlines", description: "The five most recent news articles.", endpoint: "/company-news?symbol={ticker}", example: "\"NVIDIA Announces Blackwell GPUs\" · Reuters" },
      { source: "finnhub", title: "Wall Street ratings", description: "Buy, hold and sell ratings.", endpoint: "/stock/recommendation?symbol={ticker}", example: "Strong buy 38 · Buy 6 · Hold 3" },
    ],
    notes: ["Price targets and forward estimates are on no data plan we hold. The tool says so instead of guessing."],
  },
  get_market_context: {
    name: "Market context",
    kind: "market",
    sources: ["alpaca", "finnhub"],
    summary: "SPY, VIXY's day move, the 11 sector ETFs, how many companies report this week, and the regime: SPY against its averages.",
    resources: [
      { source: "alpaca", title: "Index and sector quotes", description: "SPY, VIXY and 11 sector ETFs in one call. VIXY is an ETF of VIX futures; no plan we hold serves the VIX index itself.", endpoint: "/v2/stocks/snapshots?symbols=SPY,VIXY,XLK,...", example: "SPY $542.31 +0.8% · VIXY −1.7% · XLK +1.2% (leading)" },
      { source: "finnhub", title: "Broad market trend", description: "30 days of SPY, to place it against its averages.", endpoint: "/stock/candle?symbol=SPY&resolution=D", example: "SPY above its 20-day ($538.50) · uptrend" },
      { source: "finnhub", title: "Earnings density", description: "How many companies report in the next five days.", endpoint: "/calendar/earnings", example: "47 companies reporting · elevated" },
    ],
    notes: ["No economic calendar: neither vendor we pay for serves one, so macro events stay empty rather than guessed."],
  },
  get_earnings_data: {
    name: "Earnings for one stock",
    kind: "market",
    sources: ["finnhub"],
    summary: "The next report date, EPS estimates and the beat-rate track record for one stock.",
    resources: [
      { source: "finnhub", title: "Next report date", description: "When, before or after the market, with EPS and revenue estimates.", endpoint: "/calendar/earnings?symbol={ticker}", example: "Reports Mar 26 after the close · EPS est. $0.84" },
      { source: "finnhub", title: "Track record", description: "The last 8 quarters, actual against expected.", endpoint: "/stock/earnings?symbol={ticker}&limit=8", example: "Beat rate 87.5% (7 of 8) · last quarter +5.9%" },
    ],
  },
  get_earnings_calendar: {
    name: "Earnings calendar",
    kind: "market",
    sources: ["finnhub"],
    summary: "Who reports in the next few days, or who just reported and by how much they beat. Scope it to your book, to stocks you don't cover yet, or everything.",
    resources: [
      { source: "finnhub", title: "Earnings calendar", description: "Upcoming or just-reported earnings with the time of day, the estimates and the surprise.", endpoint: "/calendar/earnings?from={start}&to={end}", example: "NVDA 2026-05-21 after the close · est. $0.84" },
    ],
    notes: ["Coverage is your watchlist and holdings; universe is everything you don't cover yet."],
  },
  get_market_movers: {
    name: "Market movers",
    kind: "market",
    sources: ["alpaca"],
    summary: "Today's gainers, losers and most active, each with its 5-day, 1-month and 6-month move, so a one-day pop reads differently from a steady climber.",
    resources: [
      { source: "alpaca", title: "Gainers and losers", description: "Top stocks by percent move today, with warrants and rights filtered out.", endpoint: "/v1beta1/screener/stocks/movers", example: "SMMT +18.4% · 5d +22% · 1m +31%" },
      { source: "alpaca", title: "Most active", description: "Top stocks by volume today.", endpoint: "/v1beta1/screener/stocks/most-actives", example: "NVDA 312M shares" },
    ],
  },
  run_screen: {
    name: "Setup screens",
    kind: "market",
    sources: ["alpaca", "finnhub"],
    summary: "A candidate list for one setup, with the numbers: post-earnings drift, episodic pivots, pullbacks to a rising average, base breakouts and momentum leaders.",
  },
  get_catalyst_calendar: {
    name: "FDA catalyst calendar",
    kind: "market",
    sources: ["sec"],
    summary: "Dated FDA decisions taken from the companies' own 8-K filings, with the sentence they wrote and a link to the document.",
  },
  get_sec_filings: {
    name: "SEC filings",
    kind: "market",
    sources: ["sec"],
    summary: "Recent filings for one company: annual and quarterly reports, material events and insider trades. It can read a filing's text.",
    resources: [
      { source: "sec", title: "Company lookup", description: "Finds the SEC CIK identifier.", endpoint: "sec.gov/files/company_tickers_exchange.json", example: "NVDA → CIK 0001045810" },
      { source: "sec", title: "Recent filings", description: "The last 8 filings: annuals, quarterlies, material events, insider trades.", endpoint: "data.sec.gov/submissions/CIK{cik}.json", example: "8-K Mar 15 · Form 4, insider sale of 50K shares" },
      { source: "sec", title: "Filing text", description: "The words of one filing or its press-release exhibit, cleaned, with 8-K items labelled.", endpoint: "sec.gov/Archives/edgar/data/{cik}/{accession}/{document}", example: "[Item 8.01, other events] On September 21, 2026, the Company…" },
    ],
  },
  web_search: {
    name: "Web search",
    kind: "market",
    sources: ["perplexity", "anthropic"],
    summary: "Live web search. Most agents use Perplexity Sonar; the Writer uses Claude's own web search. Each run has a search budget.",
    resources: [
      { source: "perplexity", title: "Sonar web search", description: "Real-time web search with recency filtering.", endpoint: "searchSignals(query, { recency })", example: "5 results · sentiment: bullish" },
      { source: "anthropic", title: "Claude web search", description: "The Writer's searches, run by Claude inside its research call.", endpoint: "anthropic.tools.webSearch({ maxUses: 4 })" },
    ],
  },
  twitter_search: {
    name: "X search",
    kind: "market",
    sources: ["xai"],
    summary: "Posts on X about a stock, a theme or a handle, found with Grok, each tagged with who said it and what kind of call it is.",
  },
  get_earnings_history: {
    name: "Earnings track record",
    kind: "market",
    sources: ["finnhub"],
    summary: "Quarters of reported against expected EPS and revenue, pulled for the Writer before it writes.",
  },
  get_financials_deep: {
    name: "Financial statements",
    kind: "market",
    sources: ["finnhub"],
    summary: "Five years of income statement, balance sheet and cash flow from the company's own filed reports.",
  },
  get_insider_activity: {
    name: "Insider activity",
    kind: "market",
    sources: ["finnhub", "sec"],
    summary: "Insider buys and sales, with open-market buys called out.",
  },
  get_peers_with_metrics: {
    name: "Peers",
    kind: "market",
    sources: ["finnhub"],
    summary: "Close competitors with growth, margins and valuation side by side.",
  },
  get_analyst_coverage: {
    name: "Analyst coverage",
    kind: "market",
    sources: ["finnhub"],
    summary: "Buy, hold and sell ratings on the stock and how they've moved.",
  },

  // ── Your book ────────────────────────────────────────────────────────
  get_theses: {
    name: "Your theses",
    kind: "book",
    sources: ["hindsight"],
    summary: "The analyst's book: every stock it holds or watches, each with its situations and the guidance for them. Ask for one stock to get its full thesis and history.",
  },
  get_portfolio_context: {
    name: "Portfolio",
    kind: "book",
    sources: ["hindsight", "alpaca"],
    summary: "Open positions with live price, gain, days held, distance from the high, floor and target; cash, equity, open risk and the daily digest.",
  },
  list_proposals: {
    name: "Waiting for you",
    kind: "book",
    sources: ["hindsight"],
    summary: "Trade proposals awaiting your approval, with the reason and the 24-hour clock. Read only: approving is yours.",
  },
  list_analysts: {
    name: "Analysts",
    kind: "book",
    sources: ["hindsight"],
    summary: "Every analyst with quick stats: on or off, open positions, watchlist size, last run.",
  },
  read_analyst_config: {
    name: "Analyst settings",
    kind: "book",
    sources: ["hindsight"],
    summary: "One analyst's full setup: its strategy, universe, sizing and exclusions.",
  },
  list_runs: {
    name: "Runs",
    kind: "book",
    sources: ["hindsight"],
    summary: "Recent runs across analysts, filtered by analyst, kind or status.",
  },
  read_run: {
    name: "One run",
    kind: "book",
    sources: ["hindsight"],
    summary: "One run in detail: what it decided, what it changed, which tools it called.",
  },
  read_trade_results: {
    name: "Trade results",
    kind: "book",
    sources: ["hindsight"],
    summary: "How closed trades did: win rate, average R, days held and give-back from the high, by setup and by analyst.",
  },
  read_accuracy_reports: {
    name: "Weekly scorecards",
    kind: "book",
    sources: ["hindsight"],
    summary: "The Sunday scorecards: win rate, how well conviction matched outcomes, and the week in a paragraph.",
  },
  read_database: {
    name: "Database lookup",
    kind: "book",
    sources: ["hindsight"],
    summary: "A read-only lookup for questions no other tool covers, limited to your account.",
  },
  read_knowledge_library: {
    name: "Strategy library",
    kind: "book",
    sources: ["hindsight"],
    summary: "Strategy archetypes and vetted research sources, used when building or editing an analyst.",
  },

  // ── Changing a thesis ────────────────────────────────────────────────
  record_thesis: {
    name: "New thesis",
    kind: "thesis",
    sources: ["hindsight"],
    summary: "Starts a thesis on a new stock, or records a researched pass so the idea isn't pitched again.",
  },
  update_thesis: {
    name: "Edit a thesis",
    kind: "thesis",
    sources: ["hindsight"],
    summary: "Changes a thesis in place: a trigger added, edited or removed by id, the belief, the score, the status. Each change is one line in Activity.",
  },
  write_note: {
    name: "Your note",
    kind: "thesis",
    sources: ["hindsight"],
    summary: "Saves your reasoning on a stock, in your words. The analyst reads your newest notes first.",
  },
  dispatch_thesis_research: {
    name: "Send to the Writer",
    kind: "thesis",
    sources: ["hindsight", "inngest"],
    summary: "Starts the Writer on one stock: fresh research and a rewritten thesis in about four minutes.",
    resources: [
      { source: "inngest", title: "app/thesis.write.requested", description: "Starts the Writer as its own run, linked to the run that asked.", endpoint: "inngest.send({ name: 'app/thesis.write.requested' })" },
    ],
  },
  wait_for_thesis_refresh: {
    name: "Check on the Writer",
    kind: "thesis",
    sources: ["hindsight"],
    summary: "Waits for, or checks on, a Writer it started, and returns the fresh thesis when it lands.",
  },
  submit_thesis: {
    name: "Submit the thesis",
    kind: "thesis",
    sources: ["hindsight"],
    summary: "The Writer's last step: the decision (direction, plan, triggers, conviction) handed back and checked before it's saved.",
  },

  // ── Trades ───────────────────────────────────────────────────────────
  place_trade: {
    name: "Buy",
    kind: "trade",
    sources: ["alpaca", "hindsight"],
    approval: true,
    summary: "Proposes a buy on a stock with a thesis, sized by risk: the dollars at risk over the distance to the floor, scaled by conviction.",
    resources: [
      { source: "alpaca", title: "Submit order", description: "A market order, sent once you approve.", endpoint: "placeMarketOrder({ symbol, qty, side })", example: "BUY 74 shares NVDA @ $134.23" },
      { source: "hindsight", title: "Record position", description: "Saves the position and moves the thesis from Watching to Holding.", endpoint: "prisma.position.create()" },
    ],
  },
  manage_position: {
    name: "Add or trim",
    kind: "trade",
    sources: ["alpaca", "hindsight"],
    approval: true,
    summary: "Adds to a winner, sized at half the first buy's risk, or trims part of a position. Every action carries its reason.",
  },
  close_position: {
    name: "Sell",
    kind: "trade",
    sources: ["alpaca", "hindsight"],
    approval: true,
    summary: "Proposes selling the whole position, with why it's closing: the floor, the target, or a broken belief.",
    resources: [
      { source: "alpaca", title: "Sell all shares", description: "Closes the full position once you approve.", endpoint: "closeOpenPosition(symbol)", example: "Closed 50 AAPL @ $192.40 · +$710 (+7.9%)" },
      { source: "hindsight", title: "Record outcome", description: "Marks the position closed with the gain and the reason.", endpoint: "tradeDecision.create({ SELL })", example: "EXIT: TARGET · WIN · +$710" },
    ],
  },

  // ── Running the run ──────────────────────────────────────────────────
  ask_question: {
    name: "Ask you",
    kind: "run",
    sources: ["hindsight"],
    summary: "A question card with two to five answers to tap.",
  },
  suggest_config: {
    name: "Propose settings",
    kind: "run",
    sources: ["hindsight"],
    summary: "An analyst's full setup, shown beside today's for you to accept.",
  },
  record_run_summary: {
    name: "Run summary",
    kind: "run",
    sources: ["hindsight"],
    summary: "The ranked recap: each stock with the action taken, checked against what the run actually did.",
  },
  complete_run: {
    name: "Finish the run",
    kind: "run",
    sources: ["hindsight"],
    summary: "Closes the run once its summary matches its actions.",
  },
};


/** A setup as the docs show it: the playbook entry in lib/agent/knowledge/setups.ts, text only. */
export interface DocsSetup {
  id: string;
  name: string;
  role: "ENTRY" | "SCREEN";
  summary: string;
  preconditions: readonly string[];
  entry: string;
  stop: string;
  target: string;
  time: string;
  failureSigns: readonly string[];
}
