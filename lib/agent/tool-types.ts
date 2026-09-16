/**
 * Tool Result Types — canonical shapes for all agent tool returns.
 *
 * Conventions:
 *   - camelCase for all field names
 *   - Research/intelligence tools return ResearchToolResult<T>
 *   - Action tools return domain-specific shapes matching their UI card props
 *   - null for missing data, not undefined (JSON serialization)
 *   - Prices as raw floats, percentages as floats (e.g. 2.5 = 2.5%)
 *   - Dates as ISO strings "YYYY-MM-DD"
 */

// ─── Shared Types ───────────────────────────────────────────────────────────

/** Source attribution — used in _sources arrays and UI SourceChips */
export interface ToolSource {
  provider: string;
  title: string;
  url?: string;
  excerpt?: string;
}

/** Per-ticker finding — the universal "here's what I found about a stock" unit */
export interface TickerFinding {
  ticker: string;
  tag?: string; // "Holding" | "Watching" | "Opportunity" | "Research" | urgency levels
  summary: string;
}

/** Envelope — every research/intelligence tool returns this shape */
export interface ResearchToolResult<T = Record<string, unknown>> {
  summary: string;
  tickers?: TickerFinding[];
  _sources: ToolSource[];
  data: T;
}

/** News item — Finnhub news in get_stock_data */
export interface NewsItem {
  headline: string;
  summary: string;
  source: string;
  url: string;
  date: string;
}

/** Source reference inside signal/search results — replaces parallel sourceNames[]/sourceUrls[] */
export interface SourceRef {
  name: string;
  url: string;
}

/** One web_search result. */
export interface SignalItem {
  headline: string;
  summary: string;
  tickers: string[];
  themes: string[];
  sentiment: string; // BULLISH | BEARISH | NEUTRAL | MIXED
  urgency: string; // LOW | MEDIUM | HIGH | BREAKING
  sources: SourceRef[];
  type?: string;
  freshness?: string;
}

// ─── Per-Tool Data Types ────────────────────────────────────────────────────

/** get_market_context → data */
export interface MarketContextData {
  spy: { price: number; changePct: number; dayHigh: number; dayLow: number } | null;
  vix: { level: number; changePct: number | null } | null;
  regime: "RISK_ON" | "RISK_OFF" | "NEUTRAL";
  spyTrend: {
    sma20: number;
    position: "above" | "below";
    pctFromSma: number;
  } | null;
  sectors: { symbol: string; changePct: number }[];
  macroEvents: {
    event: string;
    actual: number | null;
    estimate: number | null;
    impact: "HIGH" | "MEDIUM" | "LOW";
  }[];
  earningsDensity: { count: number; period: string };
  apiErrors?: string[];
}

/** get_earnings_data → data */
export interface EarningsDataData {
  nextEarnings: { date: string; epsEstimate: number | null } | null;
  beatRate: string;
  recentQuarters: {
    period: string;
    actualEps: number;
    estimatedEps: number;
    surprise: number;
    surprisePct: number;
  }[];
}

/** get_sec_filings → data */
export interface SecFilingsData {
  filings: { type: string; date: string; description: string }[];
  count: number;
}

/** web_search → data */
export interface WebSearchToolData {
  query: string;
  resultCount: number;
  budgetUsed: number;
  budgetMax: number;
  results: SignalItem[];
}

// ─── Helper: convert parallel sourceNames/sourceUrls to SourceRef[] ─────────

export function toSourceRefs(
  sourceNames: string[],
  sourceUrls: string[],
): SourceRef[] {
  return sourceUrls.map((url, i) => ({
    name: sourceNames[i] ?? "",
    url,
  }));
}

// ─── Helper: build ToolSource[] from SourceRef[] for _sources envelope ──────

export function sourceRefsToToolSources(refs: SourceRef[]): ToolSource[] {
  const seen = new Set<string>();
  const sources: ToolSource[] = [];
  for (const ref of refs) {
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    let domain = "";
    try {
      domain = new URL(ref.url).hostname.replace(/^www\./, "");
    } catch {
      /* */
    }
    sources.push({
      provider: domain || ref.name,
      title: ref.name || domain,
      url: ref.url,
    });
  }
  return sources;
}
