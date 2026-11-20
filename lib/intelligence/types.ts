// ── V3 Intelligence Layer Types ──────────────────────────────────────────────
// Type definitions for the persistent intelligence backbone.
// These types are used by:
//   - Background intelligence jobs (Inngest functions)
//   - Sonar API response parsing
//   - Signal creation/routing utilities
//   - Intelligence config UI

// ── Enums (string unions matching Prisma schema) ────────────────────────────

export type SignalSentiment = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";

export type SignalUrgency = "LOW" | "MEDIUM" | "HIGH" | "BREAKING";

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
  // Session 3 / Workstream B — narrower industry tags so Signal.industries gets
  // populated for the router's INDUSTRY_MATCH code. Optional in responses for
  // robustness against older prompts that don't request it.
  industries?: string[];
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
          industries: {
            type: "array" as const,
            items: { type: "string" as const },
            description:
              "Narrower industry classifications (e.g. Semiconductors, Biotech, EV_OEM, Cloud_Software). Optional.",
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
