// ── Intelligence Page Types ──────────────────────────────────────────────────
// Shared types for all intelligence components. Matches API response shapes.

export interface IntelligenceQuery {
  id: string;
  query: string;
  category: string;
  scope: string;
  analystId: string | null;
  enabled: boolean;
  createdBy: string;
  expiresAt: string | null;
  sourceRunId: string | null;
  createdAt: string;
}

export interface Source {
  id: string;
  name: string;
  type: string;
  url: string | null;
  domain: string | null;
  category: string;
  qualityScore: number;
  enabled: boolean;
  lastCheckedAt: string | null;
}

export interface SourcePack {
  id: string;
  name: string;
  scope: string;
  analystId: string | null;
  sources: Array<{
    id: string;
    priority: number;
    source: Source;
  }>;
}

export interface Signal {
  id: string;
  type: string;
  headline: string;
  summary: string;
  tickers: string[];
  themes: string[];
  sectors: string[];
  sentiment: string;
  urgency: string;
  freshness: string;
  sourceUrls: string[];
  sourceNames: string[];
  sourceQuality: number;
  noveltyScore: number;
  artifactId: string | null;
  createdAt: string;
  batch: {
    jobType: string;
    status: string;
    startedAt: string;
  };
}

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
  MARKET_SWEEP: "Market Sweep",
  PORTFOLIO_MONITOR: "Portfolio Monitor",
  SOURCE_PACK: "Source Pack Monitor",
  SIGNAL_ROUTER: "Signal Router",
  MORNING_BRIEF: "Morning Brief",
  EMAIL_INGEST: "Email Ingest",
  MANUAL: "Manual",
};

export const JOB_DESCRIPTIONS: Record<string, { short: string; long: string }> = {
  "Market Sweep": {
    short: "Searches for market-moving news across all enabled queries",
    long: "Runs every enabled search query from Config through Perplexity Sonar. Results get parsed into structured signals with tickers, sentiment, urgency, and themes. Signals are deduplicated against the last 48 hours before storage.",
  },
  "Portfolio Monitor": {
    short: "Monitors open positions and watchlist for price alerts and news",
    long: "Checks current prices and recent news for every open position and watchlist item across all analysts. Generates alerts for stop-loss proximity, target price hits, and material news that could affect trade thesis.",
  },
  "Source Pack": {
    short: "Crawls monitored domains for new articles, filings, and releases",
    long: "Iterates over every enabled Source from Config. Uses Perplexity Sonar for domain-scoped search, then Firecrawl for full-text extraction of high-value pages. Creates artifact records with extracted content that become signals.",
  },
  "Signal Router": {
    short: "Routes unprocessed signals to matching analysts by coverage area",
    long: "Takes all unrouted signals and matches them against each analyst's sector coverage, ticker watchlist, and category preferences. Each signal gets urgency-priority routing so analysts see the most important signals first in their briefs.",
  },
  "Morning Brief": {
    short: "Generates personalized daily briefs for each analyst from their signals",
    long: "Uses GPT-4o to synthesize each analyst's pending signals into a structured brief: market context, portfolio alerts, watchlist updates, new opportunities, and attention priorities. Briefs appear in the Signals tab.",
  },
};

export const JOB_TRIGGERS: Record<string, { event: string; time: string }> = {
  "Market Sweep": { event: "market-sweep", time: "6:30 AM" },
  "Portfolio Monitor": { event: "portfolio-monitor", time: "7:00 AM" },
  "Source Pack": { event: "source-pack-monitor", time: "7:15 AM" },
  "Signal Router": { event: "signal-router", time: "7:30 AM" },
  "Morning Brief": { event: "morning-brief", time: "7:45 AM" },
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
