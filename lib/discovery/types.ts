/**
 * Canonical types for the market overview tool output.
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
  _sources: {
    provider: string;
    title: string;
    url: string;
    excerpt: string;
  }[];
}
