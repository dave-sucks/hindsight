// ── V3 Intelligence Layer Types ──────────────────────────────────────────────
// Type definitions for the persistent intelligence backbone.
// These types are used by:
//   - Background intelligence jobs (Inngest functions)
//   - Sonar API response parsing
//   - Signal creation/routing utilities
//   - Runtime tools (read_morning_brief, read_signals)
//   - Intelligence config UI

// ── Enums (string unions matching Prisma schema) ────────────────────────────

export type SourceType = "DOMAIN" | "RSS" | "NEWSLETTER" | "TWITTER" | "API";

export type SourceCategory =
  | "MARKET"
  | "SECTOR"
  | "COMPANY"
  | "THEMATIC"
  | "SOCIAL"
  | "EVENT";

export type SourcePackScope = "FIRM" | "ANALYST";

export type CheckFrequency = "HOURLY" | "DAILY" | "WEEKLY";

export type QueryCategory =
  | "MARKET"
  | "SECTOR"
  | "TICKER"
  | "THEMATIC"
  | "EVENT";

export type QueryCreator =
  | "USER"
  | "BRIEFING_AGENT"
  | "ANALYST_BUILDER"
  | "ANALYST_RUNTIME";

export type SignalType =
  | "NEWS"
  | "EARNINGS"
  | "FILING"
  | "SOCIAL"
  | "PRICE_ACTION"
  | "ANALYST_NOTE"
  | "OPTIONS"
  | "MACRO"
  | "SECTOR";

export type SignalSentiment = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";

export type SignalUrgency = "LOW" | "MEDIUM" | "HIGH" | "BREAKING";

export type SignalFreshness = "BREAKING" | "TODAY" | "THIS_WEEK" | "OLDER";

export type SignalRouteStatus = "PENDING" | "READ" | "ACTED_ON" | "DISMISSED";

export type BatchJobType =
  | "MARKET_SWEEP"
  | "PORTFOLIO_MONITOR"
  | "SOURCE_PACK"
  | "EMAIL_INGEST"
  | "MANUAL";

export type BatchStatus = "RUNNING" | "COMPLETE" | "FAILED";

export type WatchlistRecommendation = "ESCALATE" | "MONITOR" | "REMOVE";

// ── Sonar Response Schema ───────────────────────────────────────────────────
// JSON schema definition passed to Perplexity Sonar via response_format.
// Sonar returns structured data matching this shape.

/** A single signal extracted by Sonar from search results. */
export interface SonarSignalOutput {
  headline: string;
  summary: string;
  tickers: string[];
  themes: string[];
  sectors: string[];
  sentiment: SignalSentiment;
  urgency: SignalUrgency;
  sourceUrls: string[];
  sourceNames: string[];
}

/** The top-level Sonar response_format schema for signal extraction. */
export interface SonarSignalResponse {
  signals: SonarSignalOutput[];
}

/**
 * JSON Schema definition for Sonar response_format parameter.
 * Pass this as `response_format.json_schema.schema` in Sonar API calls.
 */
export const SONAR_SIGNAL_SCHEMA = {
  type: "object" as const,
  properties: {
    signals: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          headline: {
            type: "string" as const,
            description: "One-line summary of the signal",
          },
          summary: {
            type: "string" as const,
            description: "2-3 sentence structured summary of the evidence",
          },
          tickers: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Stock tickers mentioned (e.g. AAPL, TSLA)",
          },
          themes: {
            type: "array" as const,
            items: { type: "string" as const },
            description:
              "Thematic tags (e.g. AI_CAPEX, FED_RATE_CUT, EARNINGS_BEAT)",
          },
          sectors: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Sectors involved (e.g. Technology, Healthcare)",
          },
          sentiment: {
            type: "string" as const,
            enum: ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"],
          },
          urgency: {
            type: "string" as const,
            enum: ["LOW", "MEDIUM", "HIGH", "BREAKING"],
          },
          sourceUrls: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "URLs of the sources this signal is derived from",
          },
          sourceNames: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Publication names (e.g. Reuters, CNBC)",
          },
        },
        required: [
          "headline",
          "summary",
          "tickers",
          "themes",
          "sectors",
          "sentiment",
          "urgency",
          "sourceUrls",
          "sourceNames",
        ],
      },
    },
  },
  required: ["signals"],
};

// ── Morning Brief Types ─────────────────────────────────────────────────────
// Structured output from the morning brief generator job.

export interface PortfolioAlert {
  ticker: string;
  alert: string;
  urgency: SignalUrgency;
  signalIds: string[];
}

export interface WatchlistUpdate {
  ticker: string;
  update: string;
  recommendation: WatchlistRecommendation;
  signalIds: string[];
}

export interface NewOpportunity {
  headline: string;
  tickers: string[];
  thesisSeed: string;
  signalIds: string[];
}

export interface MorningBriefData {
  marketContext: string;
  portfolioAlerts: PortfolioAlert[];
  watchlistUpdates: WatchlistUpdate[];
  newOpportunities: NewOpportunity[];
  attentionPriority: string[];
  riskFlags: string[];
}

// ── Signal Creation Input ───────────────────────────────────────────────────
// Used by intelligence jobs to create signals in the DB.

export interface CreateSignalInput {
  batchId: string;
  artifactId?: string;
  type: SignalType;
  headline: string;
  summary: string;
  evidence?: string;
  tickers: string[];
  themes: string[];
  sectors: string[];
  sentiment: SignalSentiment;
  noveltyScore?: number;
  urgency: SignalUrgency;
  sourceQuality?: number;
  freshness: SignalFreshness;
  sourceUrls: string[];
  sourceNames: string[];
  expiresAt?: Date;
}

// ── Signal Routing ──────────────────────────────────────────────────────────

export interface RouteDecision {
  analystId: string;
  signalId: string;
  relevanceScore: number;
  routeReason: string;
}

// ── Intelligence Query Types ────────────────────────────────────────────────
// For the config UI and job execution.

export interface IntelligenceQueryConfig {
  query: string;
  category: QueryCategory;
  scope: SourcePackScope;
  analystId?: string;
  expiresAt?: Date;
  createdBy: QueryCreator;
}

// ── Source Pack Seed Types ───────────────────────────────────────────────────
// Used by the seed script to define initial source packs.

export interface SourceSeed {
  name: string;
  type: SourceType;
  url?: string;
  domain?: string;
  category: SourceCategory;
  qualityScore: number;
}

export interface SourcePackSeed {
  name: string;
  scope: SourcePackScope;
  sources: Array<{
    name: string; // references a SourceSeed by name
    priority: number;
  }>;
}

export interface IntelligenceQuerySeed {
  query: string;
  category: QueryCategory;
  scope: SourcePackScope;
}

// ── Runtime Tool Types ──────────────────────────────────────────────────────
// Used by agent runtime tools to query the intelligence layer.

export interface ReadSignalsFilter {
  analystId: string;
  tickers?: string[];
  themes?: string[];
  urgency?: SignalUrgency;
  status?: SignalRouteStatus;
  limit?: number;
}

export interface ReadSignalsResult {
  signals: Array<{
    id: string;
    headline: string;
    summary: string;
    tickers: string[];
    themes: string[];
    sentiment: SignalSentiment;
    urgency: SignalUrgency;
    freshness: SignalFreshness;
    sourceNames: string[];
    relevanceScore: number;
    routeReason: string;
  }>;
  totalCount: number;
}
