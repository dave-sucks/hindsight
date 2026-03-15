/**
 * Canonical types for market discovery tools.
 */

export interface MacroEvent {
  event: string;
  actual: number | null;
  estimate: number | null;
  impact: "HIGH" | "MEDIUM" | "LOW";
}

export interface SectorQuote {
  symbol: string;
  price: number;
  change_pct: number;
  momentum?: "leading" | "lagging";
}

export interface SpyTrend {
  sma_20: number;
  position: "above" | "below";
  pct_from_sma: number;
}

export interface EarningsDensity {
  count: number;
  period: string;
}

export type MarketRegime = "RISK_ON" | "RISK_OFF" | "NEUTRAL";

export interface MarketOverviewResult {
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
  regime: MarketRegime;
  spy_trend: SpyTrend | null;
  macro_events_today: MacroEvent[];
  earnings_density: EarningsDensity;
  api_errors?: string[];
  note?: string;
  _sources: ToolSource[];
}

// ── Shared source type ─────────────────────────────────────────────────────

export interface ToolSource {
  provider: string;
  title: string;
  url: string;
  excerpt: string;
}

// ── Market Themes ──────────────────────────────────────────────────────────

export interface ThemeDefinition {
  label: string;
  keywords: string[];
  tickers: string[];
  sectors: string[];
}

export const THEME_DEFINITIONS: Record<string, ThemeDefinition> = {
  ai_infrastructure: {
    label: "AI Infrastructure",
    keywords: ["artificial intelligence", "AI", "GPU", "data center", "machine learning", "LLM", "generative AI", "neural", "compute", "chips"],
    tickers: ["NVDA", "AMD", "AVGO", "MRVL", "SMCI", "MSFT", "GOOGL", "META", "AMZN", "TSM"],
    sectors: ["XLK"],
  },
  semiconductor_cycle: {
    label: "Semiconductor Cycle",
    keywords: ["semiconductor", "chip", "wafer", "foundry", "DRAM", "NAND", "memory", "fab", "lithography", "EUV"],
    tickers: ["NVDA", "AMD", "INTC", "TSM", "AVGO", "QCOM", "MU", "LRCX", "AMAT", "KLAC", "ASML"],
    sectors: ["XLK"],
  },
  energy_transition: {
    label: "Energy Transition",
    keywords: ["solar", "wind", "EV", "battery", "lithium", "renewable", "clean energy", "hydrogen", "grid", "nuclear"],
    tickers: ["TSLA", "ENPH", "FSLR", "NEE", "LI", "RIVN", "PLUG", "BE", "VST", "CEG"],
    sectors: ["XLE", "XLU"],
  },
  biotech_pharma: {
    label: "Biotech & Pharma",
    keywords: ["FDA", "drug", "trial", "biotech", "pharma", "approval", "pipeline", "clinical", "PDUFA", "GLP-1", "obesity"],
    tickers: ["LLY", "NVO", "MRNA", "AMGN", "GILD", "BIIB", "VRTX", "REGN", "BMY", "PFE"],
    sectors: ["XLV"],
  },
  china_trade: {
    label: "China & Trade",
    keywords: ["China", "tariff", "trade war", "export ban", "sanctions", "geopolitical", "Taiwan", "decoupling", "reshoring"],
    tickers: ["BABA", "PDD", "JD", "BIDU", "NIO", "XPEV", "FXI", "KWEB"],
    sectors: ["XLK", "XLI"],
  },
  rates_and_fed: {
    label: "Rates & Fed Policy",
    keywords: ["Fed", "rate cut", "rate hike", "inflation", "CPI", "PPI", "jobs", "unemployment", "treasury", "yield", "dovish", "hawkish", "FOMC", "Powell"],
    tickers: ["TLT", "SHY", "GLD", "JPM", "BAC", "GS", "MS"],
    sectors: ["XLF"],
  },
  consumer_spending: {
    label: "Consumer Spending",
    keywords: ["consumer", "retail", "spending", "e-commerce", "holiday", "luxury", "discretionary", "credit card"],
    tickers: ["AMZN", "WMT", "COST", "TGT", "HD", "NKE", "SBUX", "MCD", "V", "MA"],
    sectors: ["XLY", "XLP"],
  },
  real_estate_reits: {
    label: "Real Estate & REITs",
    keywords: ["real estate", "REIT", "housing", "mortgage", "commercial real estate", "office", "CRE"],
    tickers: ["O", "AMT", "PLD", "EQIX", "SPG", "DLR", "PSA", "AVB"],
    sectors: ["XLRE"],
  },
  commodities_resources: {
    label: "Commodities & Resources",
    keywords: ["oil", "crude", "gold", "copper", "mining", "commodity", "OPEC", "natural gas", "steel"],
    tickers: ["XOM", "CVX", "COP", "SLB", "FCX", "NEM", "BHP", "RIO", "CLF"],
    sectors: ["XLE", "XLB"],
  },
  defense_aerospace: {
    label: "Defense & Aerospace",
    keywords: ["defense", "military", "Pentagon", "aerospace", "drone", "missile", "contract", "NATO", "conflict"],
    tickers: ["LMT", "RTX", "NOC", "GD", "BA", "LHX", "HII", "KTOS"],
    sectors: ["XLI"],
  },
};

export type ThemeDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface MarketTheme {
  id: string;
  label: string;
  strength: number;
  direction: ThemeDirection;
  tickers: string[];
  headline_matches: number;
  reddit_overlap: number;
  representative_headlines: string[];
}

export interface DetectMarketThemesResult {
  themes: MarketTheme[];
  meta: {
    headlines_analyzed: number;
    reddit_tickers_found: number;
    lookback_days: number;
  };
  _sources: ToolSource[];
}
