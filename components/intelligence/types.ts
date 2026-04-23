// ── Intelligence Page Types ──────────────────────────────────────────────────
// Shared types for all intelligence components. Matches API response shapes.

export interface Signal {
  id: string;
  type: string;
  headline: string;
  summary: string;
  tickers: string[];
  themes: string[];
  sectors: string[];
  industries: string[];
  sentiment: string;
  urgency: string;
  freshness: string;
  sourceUrls: string[];
  sourceNames: string[];
  sourceQuality: number;
  noveltyScore: number;
  artifactId: string | null;
  // Provenance
  searchTool: string | null;
  searchQuery: string | null;
  searchContext: string | null;
  createdAt: string;
  batch: {
    jobType: string;
    status: string;
    startedAt: string;
  };
  // Monitor-based provenance
  monitorId: string | null;
  monitor: {
    id: string;
    name: string;
    type: string;
    method: string;
    config: Record<string, unknown> | null;
  } | null;
  aggregateType: string | null;
  dataPayload: unknown;
  itemCount: number | null;
  routes: Array<{
    id: string;
    analystId: string;
    analyst: { id: string; name: string };
    relevanceScore: number;
    routeReason: string;
    /** Canonical route code set by the signal router. Nullable on legacy rows. */
    routeReasonCode: RouteReasonCode | null;
    /** Per-dimension overlap explaining why the signal landed. Only populated keys contribute. */
    matchedUniverse: MatchedUniverse | null;
    status: string;
  }>;
}

// ── Route provenance (mirrors signal-router.ts; kept local so client bundles don't import server code) ──

export type RouteReasonCode =
  | "DISCOVERY"
  | "WATCHLIST"
  | "POSITION"
  | "DIRECT_TICKER"
  | "SECTOR_MATCH"
  | "INDUSTRY_MATCH"
  | "THEME_MATCH"
  | "CROSS_ANALYST";

export interface MatchedUniverse {
  sectors?: string[];
  industries?: string[];
  themes?: string[];
  inWatchlist?: boolean;
  inPositions?: boolean;
  fromAnalystId?: string;
  marketCap?: string;
}

export const ROUTE_REASON_LABELS: Record<RouteReasonCode, string> = {
  DISCOVERY: "Discovery",
  WATCHLIST: "Watchlist",
  POSITION: "Position",
  DIRECT_TICKER: "Direct ticker",
  SECTOR_MATCH: "Sector",
  INDUSTRY_MATCH: "Industry",
  THEME_MATCH: "Theme",
  CROSS_ANALYST: "Cross-analyst",
};

export const ROUTE_REASON_TOOLTIPS: Record<RouteReasonCode, string> = {
  DISCOVERY: "Signal matched two or more universe dimensions (sector + industry/theme). Came through the fence, not a direct ticker.",
  WATCHLIST: "Signal mentions a ticker on this analyst's watchlist. Bypasses the fence.",
  POSITION: "Signal mentions a ticker this analyst currently holds. Bypasses the fence.",
  DIRECT_TICKER: "Signal matched a ticker-specific monitor owned by this analyst.",
  SECTOR_MATCH: "Signal matched only the analyst's sector dimension.",
  INDUSTRY_MATCH: "Signal matched only the analyst's industry dimension.",
  THEME_MATCH: "Signal matched only the analyst's theme dimension.",
  CROSS_ANALYST: "Signal was originally routed to another analyst, cross-posted because tickers overlap with this analyst's positions or watchlist.",
};

export interface SignalBatch {
  id: string;
  jobType: string;
  status: string;
  signalCount: number;
  startedAt: string;
  completedAt: string | null;
  _count: { signals: number };
}

export interface MorningBrief {
  id: string;
  analystId: string;
  date: string;
  marketContext: string;
  portfolioAlerts: Array<{ ticker: string; alert: string; urgency: string }>;
  watchlistUpdates: Array<{ ticker: string; update: string; recommendation: string }>;
  newOpportunities: Array<{ headline: string; tickers: string[]; thesisSeed: string }>;
  attentionPriority: string[];
  riskFlags: string[];
  signalCount: number;
  generatedAt: string;
  analyst: { id: string; name: string };
}

export interface Monitor {
  id: string;
  name: string;
  type: string;
  method: string;
  config: Record<string, unknown> | null;
  scope: string;
  analystId: string | null;
  analyst: { id: string; name: string } | null;
  enabled: boolean;
  builtIn: boolean;
  origin: string;
  category: string;
  expiresAt: string | null;
  sourceRunId: string | null;
  lastRunAt: string | null;
  monitoredTickers: Array<{
    ticker: string;
    reason: string | null;
    priority?: number;
    analystId?: string;
  }> | null;
  _count: { signals: number };
  createdAt: string;
}

export interface AnalystRouteInfo {
  analystId: string;
  analystName: string;
  totalRoutes: number;
  high: number;
  medium: number;
  low: number;
  pending: number;
  read: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const JOB_LABELS: Record<string, string> = {
  MARKET_SWEEP: "Search Monitors",
  PORTFOLIO_MONITOR: "Ticker Searches",
  DOMAIN_MONITOR: "Domain Monitors",
  SIGNAL_ROUTER: "Route Findings",
  MORNING_BRIEF: "Generate Briefs",
  EMAIL_INGEST: "Email Ingest",
  MANUAL: "Manual",
};

export const JOB_DESCRIPTIONS: Record<string, { short: string; long: string }> = {
  "Market Sweep": {
    short: "Firm-wide sweep via Sonar + FMP movers + earnings calendar",
    long: "Runs every firm-wide search query through Perplexity Sonar and pulls FMP movers (gainers/losers/actives) and Finnhub earnings. Every signal is normalized to canonical GICS sectors/industries via an alias table, then deduplicated against the last 48 hours.",
  },
  "Portfolio Monitor": {
    short: "Per-ticker searches for every holding and watchlist item, per analyst",
    long: "For every analyst, runs per-ticker Sonar searches on each open position and watchlist item with forced ticker injection so the result is guaranteed to tag the target symbol. Routed directly with POSITION or WATCHLIST reason codes — these bypass the universe fence.",
  },
  "Domain Monitor": {
    short: "Domain-filtered Sonar + Firecrawl extraction for tracked sources",
    long: "For each enabled domain monitor, sends a domain-filtered Sonar query; only results from that domain come back. High-priority domains also get full-page Firecrawl extraction, stored as Artifact rows the agent can read in full during a run.",
  },
  "Signal Router": {
    short: "Routes each signal through every analyst's universe fence",
    long: "For every signal × analyst pair: checks the universe fence (sectors + industries + themes + marketCap — AND across dimensions, OR within; watchlist + positions bypass the fence; exclusionList hard-rejects). Tags each route with a reason code (POSITION +50, WATCHLIST +45, DIRECT_TICKER, DISCOVERY, INDUSTRY_MATCH +22, SECTOR_MATCH +20, THEME_MATCH +18, CROSS_ANALYST). Adds urgency bonus (BREAKING +15, HIGH +10), multiplies by a 7-day novelty score (HIGH/BREAKING get a carve-out so a hot catalyst on a familiar name still ranks), caps each analyst at 40 routes, and reserves 20% of those slots for DISCOVERY.",
  },
  "Morning Brief": {
    short: "Grounded per-analyst brief from today's routes only",
    long: "GPT-4o synthesizes each analyst's routed signals into a structured brief: market context, portfolio alerts, watchlist updates, new opportunities, attention priority, risk flags. Grounded to TODAY's routes only — every cited signalId is validated against the day's pool (hallucinated IDs trigger retry). Enforces holdings-attention: every open position must get an alert when holdingsAttention > 0. Requires at least one real discovery when the discovery bucket is non-empty.",
  },
  "Email Ingest": {
    short: "Inbound newsletter emails → extracted signals",
    long: "Resend's inbound webhook delivers emails to the intelligence pipeline. GPT-4o-mini extracts one signal per distinct investable idea from the email body — tickers, themes, urgency, sentiment, source names. Dedup by Resend email_id prevents double-ingest. Routed through the signal router alongside Sonar/FMP signals.",
  },
};

export const JOB_TRIGGERS: Record<string, { event: string; time: string }> = {
  "Market Sweep": { event: "market-sweep", time: "6:30 AM" },
  "Portfolio Monitor": { event: "portfolio-monitor", time: "7:00 AM" },
  "Domain Monitor": { event: "domain-monitor", time: "7:15 AM" },
  "Signal Router": { event: "signal-router", time: "7:30 AM" },
  "Morning Brief": { event: "morning-brief", time: "7:45 AM" },
  "Email Ingest": { event: "email-ingest", time: "on receipt" },
};

export const URGENCY_CONFIG: Record<string, { dot: string; label: string }> = {
  BREAKING: { dot: "bg-red-500", label: "Breaking" },
  HIGH: { dot: "bg-amber-500", label: "High" },
  MEDIUM: { dot: "bg-blue-500", label: "Medium" },
  LOW: { dot: "bg-muted-foreground/40", label: "Low" },
};

export const SENTIMENT_CONFIG: Record<string, { label: string; className: string }> = {
  BULLISH: { label: "Bullish", className: "text-emerald-500" },
  BEARISH: { label: "Bearish", className: "text-red-500" },
  NEUTRAL: { label: "Neutral", className: "text-muted-foreground" },
  MIXED: { label: "Mixed", className: "text-amber-500" },
};

export const MONITOR_TYPE_CONFIG: Record<string, { label: string; description: string }> = {
  SEARCH: { label: "Search", description: "Sends a query to Perplexity Sonar, gets back structured signals with headlines, tickers, and sentiment" },
  DOMAIN: { label: "Domain", description: "Sends a domain-filtered query to Perplexity Sonar, gets back signals from that site. High-priority domains also get full-page extraction via Firecrawl" },
  API: { label: "API", description: "Calls an FMP or Finnhub REST endpoint, gets back structured market data as one aggregate signal" },
};

export const MONITOR_METHOD_CONFIG: Record<string, { label: string }> = {
  perplexity_sonar: { label: "Perplexity Sonar" },
  firecrawl: { label: "Firecrawl" },
  fmp: { label: "FMP" },
  finnhub: { label: "Finnhub" },
  auto: { label: "Automatic" },
};

export const ORIGIN_LABELS: Record<string, string> = {
  USER: "You",
  BUILDER: "Analyst Builder",
  BRIEFING_AGENT: "Briefing Agent",
  SYSTEM: "System",
};

export const THEME_LABELS: Record<string, string> = {
  AI_CAPEX: "AI Capital Spending",
  FED_RATE_CUT: "Fed Rate Cut",
  EARNINGS_BEAT: "Earnings Beat",
  EARNINGS_MISS: "Earnings Miss",
  SUPPLY_CHAIN: "Supply Chain",
  TARIFFS: "Tariffs",
  GEOPOLITICAL: "Geopolitical Risk",
  ENERGY_TRANSITION: "Energy Transition",
  CRYPTO: "Cryptocurrency",
  REAL_ESTATE: "Real Estate",
  INFLATION: "Inflation",
  RECESSION: "Recession Risk",
  IPO: "IPO",
  M_AND_A: "M&A Activity",
  BUYBACK: "Share Buyback",
  DIVIDEND: "Dividend",
  INSIDER_TRADING: "Insider Trading",
  SHORT_SQUEEZE: "Short Squeeze",
  REGULATORY: "Regulatory",
  FDA_APPROVAL: "FDA Approval",
};
