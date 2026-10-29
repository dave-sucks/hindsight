// ── Perplexity Sonar API Client ──────────────────────────────────────────────
// Bulk search substrate for the intelligence backbone.
// Uses OpenAI-compatible API with Perplexity base URL.
//
// Sonar is used for background monitors (search, ticker, domain monitors).
// It returns structured JSON via response_format.
// NOT used for analyst runtime — that uses Claude web search.

import OpenAI from "openai"
import type {
  SonarSignalResponse,
  SignalSentiment,
  SignalUrgency,
} from "./types"
import { SONAR_SIGNAL_SCHEMA } from "./types"
import {
  normalizeSectors,
  normalizeIndustries,
  normalizeThemes,
} from "@/lib/universe/canonical"

// ── Client ──────────────────────────────────────────────────────────────────

const sonar = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY ?? "",
  baseURL: "https://api.perplexity.ai",
})

// ── Search Options ──────────────────────────────────────────────────────────

export interface SonarSearchOptions {
  /** Recency filter for search results */
  recency?: "hour" | "day" | "week" | "month"
  /** Restrict search to specific domains */
  domainFilter?: string[]
  /** Model to use — sonar is cheapest, sonar-pro for complex queries */
  model?: "sonar" | "sonar-pro"
  /** Max tokens for response */
  maxTokens?: number
}

// ── Core Search Function ────────────────────────────────────────────────────

/**
 * Search the web via Perplexity Sonar and get structured signal output.
 *
 * Uses response_format with JSON schema to get tickers, themes, sentiment,
 * etc. directly — no post-processing needed.
 *
 * @param query - The search query (e.g. "semiconductor supply chain news today")
 * @param options - Recency filter, domain filter, model selection
 * @returns Structured signals extracted from search results
 */
export async function searchSignals(
  query: string,
  options: SonarSearchOptions = {}
): Promise<SonarSignalResponse> {
  const {
    recency = "day",
    domainFilter,
    model = "sonar",
    maxTokens = 1024,
  } = options

  const systemPrompt = `You are a financial intelligence analyst. Extract structured signals from web search results.
For each distinct piece of news/information found, create a signal with:
- A clear headline (one line)
- A 2-3 sentence summary with specific facts, numbers, and dates
- All mentioned stock tickers in $TICKER format (without the $)
- Thematic tags (e.g. AI_CAPEX, FED_RATE_CUT, EARNINGS_BEAT, SECTOR_ROTATION)
- Relevant sectors (canonical GICS Title Case: "Information Technology", "Health Care", "Financials", "Energy", "Materials", "Industrials", "Consumer Discretionary", "Consumer Staples", "Communication Services", "Utilities", "Real Estate")
- Narrower industries (canonical GICS Title Case ONLY — e.g. "Semiconductors", "Software", "Banks", "Biotechnology", "Automobiles", "Aerospace & Defense", "Pharmaceuticals", "Interactive Media & Services"). Omit if you cannot place it in GICS. DO NOT invent theme-shaped industry labels like "AI_Hardware", "Data_Centers", "Cybersecurity", "Quantum_Computing" — those belong in the themes field, not industries.
- Sentiment assessment based on market impact
- Urgency based on time-sensitivity and magnitude

Be specific. Include numbers, dates, and names. Do not fabricate information.
If search results are thin, return fewer signals rather than padding with speculation.`

  const response = await sonar.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
    max_tokens: maxTokens,
    response_format: {
      type: "json_schema" as unknown as "json_object",
      // Perplexity accepts json_schema but the OpenAI SDK types only know json_object.
      // The actual API call works correctly — this is a type-level workaround.
      ...(({
        json_schema: {
          name: "signal_extraction",
          schema: SONAR_SIGNAL_SCHEMA,
        },
      }) as Record<string, unknown>),
    },
    // Perplexity-specific parameters (not in OpenAI SDK types)
    ...(recency && { search_recency_filter: recency }),
    ...(domainFilter &&
      domainFilter.length > 0 && { search_domain_filter: domainFilter }),
  } as Parameters<typeof sonar.chat.completions.create>[0]) as OpenAI.Chat.ChatCompletion

  const content = response.choices[0]?.message?.content
  if (!content) {
    return { signals: [] }
  }

  try {
    const parsed = JSON.parse(content) as SonarSignalResponse
    // Validate and clean the response
    return {
      signals: (parsed.signals ?? []).map(cleanSonarSignal),
    }
  } catch {
    console.error("[sonar] Failed to parse response as JSON:", content.slice(0, 200))
    return { signals: [] }
  }
}

// ── Batch Search ────────────────────────────────────────────────────────────

// ── Domain-Filtered Search ──────────────────────────────────────────────────

// ── Ticker-Specific Search ──────────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────────────

const VALID_SENTIMENTS = new Set<SignalSentiment>(["BULLISH", "BEARISH", "NEUTRAL", "MIXED"])
const VALID_URGENCIES = new Set<SignalUrgency>(["LOW", "MEDIUM", "HIGH", "BREAKING"])

/** Normalize and validate a Sonar signal output. */
function cleanSonarSignal(
  signal: SonarSignalResponse["signals"][number]
): SonarSignalResponse["signals"][number] {
  return {
    headline: (signal.headline ?? "").trim().slice(0, 500),
    summary: (signal.summary ?? "").trim().slice(0, 2000),
    tickers: (signal.tickers ?? [])
      .map((t) => t.replace(/^\$/, "").toUpperCase().trim())
      .filter(Boolean),
    // Canonicalize at the ingestion boundary (Session A). Anything the
    // normalizer can't map is dropped rather than stored as raw string — we
    // don't want a second vocabulary creeping into the Signal table.
    themes: normalizeThemes(signal.themes ?? []),
    sectors: normalizeSectors(signal.sectors ?? []),
    industries: normalizeIndustries(signal.industries ?? []),
    sentiment: VALID_SENTIMENTS.has(signal.sentiment) ? signal.sentiment : "NEUTRAL",
    urgency: VALID_URGENCIES.has(signal.urgency) ? signal.urgency : "MEDIUM",
    sourceUrls: (signal.sourceUrls ?? []).filter(Boolean),
    sourceNames: (signal.sourceNames ?? []).filter(Boolean),
  }
}
