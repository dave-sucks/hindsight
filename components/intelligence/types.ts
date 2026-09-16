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

// ── Route provenance — how a signal reached an analyst back when routing ran.
// History only: nothing writes AnalystSignalRoute any more (the router was
// deleted 2026-09-15). Kept so the podcast findings tab can label old rows. ──

export type RouteReasonCode =
  | "DISCOVERY"
  | "WATCHLIST"
  | "POSITION"
  | "DIRECT_TICKER"
  | "SECTOR_MATCH"
  | "INDUSTRY_MATCH"
  | "THEME_MATCH"
  | "CROSS_ANALYST"
  // Aggregate routes — populated when Signal.aggregateType is set (earnings
  // calendar, market movers).
  // and lib/universe/feeds.ts.
  | "FIRM_AGGREGATE_FEED"
  | "AGGREGATE_TICKER_MATCH";

export interface MatchedUniverse {
  sectors?: string[];
  industries?: string[];
  themes?: string[];
  inWatchlist?: boolean;
  inPositions?: boolean;
  fromAnalystId?: string;
  marketCap?: string;
  // Canonical FEEDS value (e.g. "EARNINGS_CALENDAR") for aggregate routes.
  feed?: string;
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
  FIRM_AGGREGATE_FEED: "Feed",
  AGGREGATE_TICKER_MATCH: "Aggregate — your ticker",
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
  FIRM_AGGREGATE_FEED: "Firm-aggregate signal routed while this analyst had a Feeds subscription (retired 2026-09-11). Historical.",
  AGGREGATE_TICKER_MATCH: "Firm-aggregate signal where at least one of the aggregate's tickers is in this analyst's watchlist or open positions. Not subscribed, but fenced to your names.",
};

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
