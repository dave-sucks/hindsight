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

/**
 * Run multiple search queries in parallel with concurrency control.
 * Used by market sweep (15 queries) and portfolio monitor (1 per ticker).
 *
 * @param queries - Array of {query, options} pairs
 * @param concurrency - Max parallel requests (default 5)
 * @returns Flat array of all signals from all queries
 */
export async function batchSearchSignals(
  queries: Array<{ query: string; options?: SonarSearchOptions }>,
  concurrency = 5
): Promise<SonarSignalResponse> {
  const allSignals: SonarSignalResponse["signals"] = []
  const chunks: Array<Array<{ query: string; options?: SonarSearchOptions }>> = []

  // Split into chunks for concurrency control
  for (let i = 0; i < queries.length; i += concurrency) {
    chunks.push(queries.slice(i, i + concurrency))
  }

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(({ query, options }) => searchSignals(query, options))
    )

    for (const result of results) {
      if (result.status === "fulfilled") {
        allSignals.push(...result.value.signals)
      } else {
        console.warn("[sonar] Search failed:", result.reason)
      }
    }
  }

  return { signals: allSignals }
}

// ── Domain-Filtered Search ──────────────────────────────────────────────────

/**
 * Search within specific domains — used by domain monitors.
 * Convenience wrapper around searchSignals with domainFilter.
 */
export async function searchDomain(
  query: string,
  domains: string[],
  recency: SonarSearchOptions["recency"] = "day"
): Promise<SonarSignalResponse> {
  return searchSignals(query, {
    domainFilter: domains,
    recency,
  })
}

// ── Ticker-Specific Search ──────────────────────────────────────────────────

/**
 * Search for news about a specific ticker — used by portfolio/watchlist monitor.
 * Adds the ticker to the query and uses day recency.
 */
export async function searchTicker(
  ticker: string,
  additionalContext?: string
): Promise<SonarSignalResponse> {
  const query = additionalContext
    ? `${ticker} stock ${additionalContext} today`
    : `${ticker} stock news developments catalysts today`

  return searchSignals(query, { recency: "day" })
}

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

// ── One structured question with its search results ─────────────────────────

/** A page Sonar read, as its response lists it. */
export interface SonarSearchResult {
  url: string
  title: string | null
  date: string | null
}

export interface SonarAnswer {
  /** The model's JSON, parsed; null when it sent none or it did not parse. */
  json: unknown
  /** The pages it searched — the only URLs a claim may cite. */
  searchResults: SonarSearchResult[]
  costUsd: number
}

const SONAR_PRICE = {
  sonar: { in: 1, out: 1, request: 0.008 },
  "sonar-pro": { in: 3, out: 15, request: 0.01 },
} as const

/**
 * Ask Sonar one question with a JSON schema for the answer (the research
 * brief, lib/research/brief.ts). Plain fetch, so a test doubles the vendor and
 * not this code. Throws on an HTTP failure; the caller records it.
 */
export async function askSonar(opts: {
  system: string
  user: string
  schema: Record<string, unknown>
  schemaName: string
  model?: "sonar" | "sonar-pro"
  /** Only pages published after this date (MM/DD/YYYY, Perplexity's format). */
  afterDate?: string
  maxTokens?: number
  timeoutMs?: number
}): Promise<SonarAnswer> {
  const model = opts.model ?? "sonar-pro"
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      max_tokens: opts.maxTokens ?? 2000,
      temperature: 0.1,
      response_format: { type: "json_schema", json_schema: { name: opts.schemaName, schema: opts.schema } },
      ...(opts.afterDate ? { search_after_date_filter: opts.afterDate } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Sonar HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    search_results?: { url?: string; title?: string; date?: string | null }[]
    citations?: string[]
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: { total_cost?: number } }
  }
  const content = body.choices?.[0]?.message?.content ?? ""
  let json: unknown = null
  try {
    // A reasoning model can lead with a <think> block; the JSON follows it.
    json = content ? JSON.parse(content.replace(/^[\s\S]*<\/think>/, "").trim()) : null
  } catch {
    console.warn("[sonar] askSonar: answer did not parse as JSON:", content.slice(0, 200))
  }
  const fromResults = (body.search_results ?? [])
    .filter((r) => typeof r.url === "string" && r.url)
    .map((r) => ({ url: r.url as string, title: r.title ?? null, date: r.date ?? null }))
  const known = new Set(fromResults.map((r) => r.url))
  const fromCitations = (body.citations ?? [])
    .filter((u) => typeof u === "string" && !known.has(u))
    .map((url) => ({ url, title: null, date: null }))
  const p = SONAR_PRICE[model]
  const tokens = ((body.usage?.prompt_tokens ?? 0) * p.in + (body.usage?.completion_tokens ?? 0) * p.out) / 1e6
  return {
    json,
    searchResults: [...fromResults, ...fromCitations],
    costUsd: body.usage?.cost?.total_cost ?? tokens + p.request,
  }
}
