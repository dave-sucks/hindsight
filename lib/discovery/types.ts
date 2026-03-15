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
export type ToolSource = {
  provider: string;   // "Finnhub", "FMP", "Reddit", "StockTwits", "SEC EDGAR"
  title: string;      // Human-readable label
  url?: string;       // Link to data source
  excerpt?: string;   // Short summary of what this source contributed
};

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

export type MarketOverviewResult = {
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

  // New fields (v1 additions)
  regime: MarketRegime;
  spy_trend: {
    sma_20: number;
    position: "above" | "below";
    pct_from_sma: number;            // e.g. 2.3 means 2.3% above SMA
  } | null;
  macro_events_today: MacroEvent[];
  earnings_density: {
    count: number;                    // companies reporting in next 5 days
    period: string;                   // e.g. "Mar 15–Mar 20"
  };

  // Error handling (existing pattern)
  api_errors?: string[];
  note?: string;

  _sources: ToolSource[];
};

export type SectorQuote = {
  symbol: string;                     // "XLK", "XLF", etc.
  price: number;
  change_pct: number;
  momentum?: SectorMomentum;         // NEW — above/below 10d SMA
};

export type MacroEvent = {
  event: string;                      // "FOMC Rate Decision"
  actual: number | null;
  estimate: number | null;
  impact: ImpactLevel;
};

// ─── Tool 2: detect_market_themes ────────────────────────────────────────────

export type DetectMarketThemesResult = {
  themes: MarketTheme[];
  meta: {
    headlines_analyzed: number;
    reddit_tickers_found: number;
    lookback_days: number;
  };

  _sources: ToolSource[];
};

export type MarketTheme = {
  name: string;                       // "AI Infrastructure", "GLP-1 Momentum"
  strength: number;                   // 0–1, normalized across themes
  direction: ThemeDirection;
  key_sectors: string[];              // ["Technology", "Semiconductors"]
  representative_tickers: string[];   // ["NVDA", "MSFT", "AVGO"]
  headline_count: number;             // how many headlines matched
  top_headlines: string[];            // up to 3 representative headlines
};

// ─── Tool 3: scan_catalysts ──────────────────────────────────────────────────

export type ScanCatalystsResult = {
  catalysts: Catalyst[];
  summary: {
    total: number;
    by_type: Record<CatalystType, number>;
    next_high_impact: string | null;  // ISO date of next HIGH impact catalyst
  };

  _sources: ToolSource[];
};

export type Catalyst = {
  ticker: string | null;              // null for macro events like "FOMC Meeting"
  catalyst_type: CatalystType;
  date: string;                       // ISO "YYYY-MM-DD"
  expected_impact: ImpactLevel;
  direction_bias: DirectionBias;
  details: string;                    // "Q1 2026 earnings, EPS est $2.35"
};

// ─── Tool 4: scan_candidates (enhanced) ──────────────────────────────────────

export type ScanCandidatesResult = {
  // Existing fields (preserved)
  earnings: ScanEarningsCandidate[];
  movers: ScanMoverCandidate[];
  total_found: number;
  sources_queried: string[];
  note: string;

  // New fields (v1 additions)
  filters_applied: {
    min_market_cap: number;           // applied floor in dollars
    min_avg_volume: number;           // applied floor in shares
    theme_filter: string | null;      // theme name if used
    dropped_count: number;            // how many candidates were filtered out
  };
  volume_spikes: string[];            // tickers with >2x avg volume

  _sources: ToolSource[];
};

export type ScanEarningsCandidate = {
  ticker: string;
  source: string;                     // comma-joined sources: "earnings_calendar, watchlist"
  date?: string;                      // earnings date
  epsEstimate?: number | null;
};

export type ScanMoverCandidate = {
  ticker: string;
  source: string;
  change_pct?: number;
  price?: number;
  volume_spike?: boolean;             // NEW — true if volume > 2x 10d avg
};

// ─── Theme keyword map type (used by themes.ts and scan_candidates) ─────────

export type ThemeDefinition = {
  keywords: string[];
  sectors: string[];
  tickers: string[];
};

/**
 * Shared theme keyword map — used by detect_market_themes for clustering
 * and by scan_candidates for theme_filter scoring.
 *
 * Lives here so both tools reference the same theme definitions.
 */
export const THEME_DEFINITIONS: Record<string, ThemeDefinition> = {
  "AI Infrastructure": {
    keywords: ["artificial intelligence", "AI", "GPU", "data center",
      "machine learning", "LLM", "nvidia", "cloud computing", "inference",
      "transformer", "generative AI"],
    sectors: ["Technology"],
    tickers: ["NVDA", "MSFT", "GOOGL", "AMD", "AVGO", "SMCI", "META",
      "TSM", "MRVL", "ARM"],
  },
  "GLP-1 / Weight Loss": {
    keywords: ["GLP-1", "Ozempic", "Wegovy", "weight loss", "obesity",
      "semaglutide", "tirzepatide", "Mounjaro", "Zepbound"],
    sectors: ["Healthcare"],
    tickers: ["LLY", "NVO", "AMGN", "VKTX", "HIMS"],
  },
  "Rate Cuts / Fed Policy": {
    keywords: ["rate cut", "Fed", "FOMC", "interest rate", "monetary policy",
      "Powell", "dovish", "hawkish", "treasury yield", "basis points"],
    sectors: ["Financials"],
    tickers: ["TLT", "SHY", "JPM", "GS", "BAC"],
  },
  "Oil / Energy": {
    keywords: ["oil", "crude", "OPEC", "energy", "natural gas", "petroleum",
      "drilling", "refining", "pipeline", "oil price"],
    sectors: ["Energy"],
    tickers: ["XOM", "CVX", "COP", "SLB", "OXY", "MPC"],
  },
  "EV / Autonomous": {
    keywords: ["electric vehicle", "EV", "autonomous", "self-driving",
      "battery", "charging", "lithium", "Tesla", "EV sales"],
    sectors: ["Consumer Discretionary"],
    tickers: ["TSLA", "RIVN", "LCID", "NIO", "LI", "XPEV", "F", "GM"],
  },
  "Crypto / Bitcoin": {
    keywords: ["bitcoin", "crypto", "ethereum", "blockchain", "BTC",
      "cryptocurrency", "digital asset", "mining", "halving", "ETF bitcoin"],
    sectors: ["Financials", "Technology"],
    tickers: ["COIN", "MSTR", "MARA", "RIOT", "SQ", "HOOD"],
  },
  "China / Trade": {
    keywords: ["China", "tariff", "trade war", "Beijing", "CCP",
      "semiconductor ban", "export controls", "stimulus China", "Alibaba"],
    sectors: ["Technology", "Consumer Discretionary"],
    tickers: ["BABA", "PDD", "JD", "BIDU", "NIO", "FXI"],
  },
  "Defense / Aerospace": {
    keywords: ["defense", "military", "Pentagon", "aerospace", "NATO",
      "missile", "drone", "arms", "defense spending", "geopolitical"],
    sectors: ["Industrials"],
    tickers: ["LMT", "RTX", "NOC", "GD", "BA", "HII"],
  },
  "Semiconductor Cycle": {
    keywords: ["semiconductor", "chip", "wafer", "foundry", "DRAM",
      "NAND", "memory", "fab", "chip shortage", "semiconductor cycle"],
    sectors: ["Technology"],
    tickers: ["NVDA", "AMD", "INTC", "TSM", "AVGO", "QCOM", "MU",
      "LRCX", "AMAT", "KLAC"],
  },
  "Banking / Financial Stress": {
    keywords: ["bank", "banking crisis", "deposit", "SVB", "FDIC",
      "regional bank", "credit", "loan loss", "delinquency", "bank run"],
    sectors: ["Financials"],
    tickers: ["JPM", "BAC", "WFC", "C", "GS", "MS", "KRE", "SCHW"],
  },
  "Consumer Spending": {
    keywords: ["consumer", "retail", "spending", "inflation", "CPI",
      "consumer confidence", "discretionary", "holiday sales", "earnings retail"],
    sectors: ["Consumer Discretionary", "Consumer Staples"],
    tickers: ["AMZN", "WMT", "TGT", "COST", "HD", "NKE"],
  },
  "Meme / Retail Squeeze": {
    keywords: ["meme stock", "short squeeze", "gamma squeeze", "WSB",
      "wallstreetbets", "diamond hands", "YOLO", "retail traders",
      "to the moon"],
    sectors: [],
    tickers: ["GME", "AMC", "BBBY", "BB", "PLTR"],
  },
};
