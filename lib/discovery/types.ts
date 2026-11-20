/**
 * Discovery Layer v1 — Canonical Output Contracts
 *
 * These types define the exact shapes returned by discovery tools.
 * All parallel implementation tracks MUST conform to these contracts.
 *
 * Conventions:
 *   - snake_case for all field names (matches existing tool outputs)
 *   - _sources array on every tool result (provider, title, url?, excerpt?)
 *   - Enums as string unions, not TS enums
 *   - null for missing data, not undefined (JSON serialization)
 *   - Numbers: prices as raw floats, percentages as floats (e.g. 2.5 = 2.5%)
 *   - Dates: ISO string "YYYY-MM-DD"
 */

// ─── Shared types ────────────────────────────────────────────────────────────

/** Source attribution — every tool result includes _sources */
export interface ToolSource {
  provider: string;   // "Finnhub", "FMP", "Reddit", "StockTwits", "SEC EDGAR"
  title: string;      // Human-readable label
  url: string;        // Link to data source (empty string if N/A)
  excerpt: string;    // Short summary of what this source contributed (empty string if N/A)
}

/** Market regime classification */
export type MarketRegime = "RISK_ON" | "RISK_OFF" | "NEUTRAL";

/** Theme direction */
export type ThemeDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

/** Catalyst types */
export type CatalystType = "EARNINGS" | "ECONOMIC" | "INSIDER" | "ANALYST_ACTION";

/** Impact level */
export type ImpactLevel = "HIGH" | "MEDIUM" | "LOW";

/** Direction bias for catalysts */
export type DirectionBias = "BULLISH" | "BEARISH" | "UNKNOWN";

/** Sector momentum classification */
export type SectorMomentum = "leading" | "lagging";

// ─── Tool 1: get_market_overview (enhanced) ──────────────────────────────────

export interface SpyTrend {
  sma_20: number;
  position: "above" | "below";
  pct_from_sma: number;            // e.g. 2.3 means 2.3% above SMA
}

export interface EarningsDensity {
  count: number;                    // companies reporting in next 5 days
  period: string;                   // e.g. "Mar 15–Mar 20"
}

export interface MacroEvent {
  event: string;                    // "FOMC Rate Decision"
  actual: number | null;
  estimate: number | null;
  impact: ImpactLevel;
}

export interface SectorQuote {
  symbol: string;                   // "XLK", "XLF", etc.
  price: number;
  change_pct: number;
  momentum?: SectorMomentum;       // above/below 10d SMA
}

export interface MarketOverviewResult {
  // Existing fields (unchanged)
  spy: {
    price: number;
    change_pct: number;
    day_high: number;
    day_low: number;
  } | null;
  vix: {
    level: number;
    change_pct: number | null;
  } | null;
  sectors: SectorQuote[];

  // v1 additions
  regime: MarketRegime;
  spy_trend: SpyTrend | null;
  macro_events_today: MacroEvent[];
  earnings_density: EarningsDensity;

  // Error handling (existing pattern)
  api_errors?: string[];
  note?: string;

  _sources: ToolSource[];
}

/** MarketContextResult — extends MarketOverviewResult with inline theme detection */
export interface MarketContextResult extends MarketOverviewResult {
  themes: MarketTheme[];
}

// ─── Tool 2: detect_market_themes ────────────────────────────────────────────

export interface MarketTheme {
  id: string;                       // snake_case key from THEME_DEFINITIONS
  label: string;                    // "AI Infrastructure", "GLP-1 / Weight Loss"
  strength: number;                 // 0–1, normalized across themes
  direction: ThemeDirection;
  tickers: string[];                // representative tickers from theme
  headline_matches: number;         // how many headlines matched
  reddit_overlap: number;           // tickers also trending on Reddit
  representative_headlines: string[]; // up to 3 representative headlines
}

// ─── Tool 3: scan_catalysts ──────────────────────────────────────────────────

export interface Catalyst {
  ticker: string | null;            // null for macro events like "FOMC Meeting"
  catalyst_type: CatalystType;
  date: string;                     // ISO "YYYY-MM-DD"
  expected_impact: ImpactLevel;
  direction_bias: DirectionBias;
  details: string;                  // "Q1 2026 earnings, EPS est $2.35"
}
