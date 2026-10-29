// ── xAI Live Search Client ──────────────────────────────────────────────────
// Wraps xAI's Live Search API for the twitter_search agent tool (SOON-1b in
// docs/plans/DISCOVERY_OVERHAUL.md). The discovery agent uses this to surface
// handle-attributed claims on X — net-new tickers via attention shifts,
// multi-archetype convergence patterns, fintwit early calls.
//
// Why a separate tool from web_search (Perplexity Sonar):
//   - Sonar searches the open web (Reuters / Bloomberg / Seeking Alpha) and
//     returns paraphrased headlines without author attribution. Great for
//     "what does consensus think about $X."
//   - xAI Live Search with sources:["x"] reads X posts directly and returns
//     handle + claim_excerpt + recency + post URL. Great for "who's calling
//     $X early, from which archetype, with what conviction."
//
// xAI's API is OpenAI-compatible at the chat-completions level. Search is
// enabled via `search_parameters` (not part of the OpenAI spec — passed as
// raw JSON). Model used: grok-4-fast-reasoning (cheap, structured-output
// capable). Bumping to grok-4 for low-volume high-stakes searches is a
// future tunable.
//
// Auth: XAI_API_KEY env var. If missing, the tool returns a structured
// failure shape and the agent can decide whether to fall back to web_search.

import { z } from "zod";

const XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_MODEL = "grok-4-fast-reasoning";
const XAI_TIMEOUT_MS = 30_000;

// ── Structured output schema ────────────────────────────────────────────────
// Grok returns a JSON array of attributed posts. Each entry pins one author's
// claim on one ticker (or thematic). Multi-ticker posts emit one entry per
// (author, ticker) — easier for the agent to score convergence.

const XaiPostSchema = z.object({
  handle: z.string().describe("X username (without @)"),
  display_name: z.string().optional().describe("User's display name if known"),
  ticker: z
    .string()
    .nullable()
    .describe(
      "Primary ticker the claim is about, UPPERCASE without $. Null if the post is thematic/macro without a single anchor ticker.",
    ),
  related_tickers: z
    .array(z.string())
    .default([])
    .describe("Other tickers mentioned in the same post"),
  archetype: z
    .enum([
      "TECHNICAL",
      "FUNDAMENTAL",
      "NARRATIVE",
      "OPTIONS_FLOW",
      "CATALYST_EVENT",
      "MACRO",
      "UNKNOWN",
    ])
    .describe(
      "What KIND of analysis the author is doing — technical (charts/patterns), fundamental (financials), narrative (theme/sector), options flow, catalyst-event, macro. UNKNOWN if unclear.",
    ),
  claim_excerpt: z
    .string()
    .describe("1-2 sentence summary of what the author is claiming"),
  sentiment: z
    .enum(["BULLISH", "BEARISH", "MIXED", "NEUTRAL"])
    .describe("Author's directional view on the ticker"),
  recency: z
    .string()
    .describe(
      "When the post was published, in human terms: 'today', 'yesterday', '3 days ago', etc.",
    ),
  post_url: z
    .string()
    .url()
    .optional()
    .describe("Direct URL to the X post if returned by the search"),
  engagement_hint: z
    .string()
    .optional()
    .describe(
      "Optional rough engagement note if Grok surfaces it: 'high engagement', '~50k views', etc. Not a precise number.",
    ),
});

const XaiSearchResponseSchema = z.object({
  posts: z.array(XaiPostSchema),
  // Optional summary the model emits to frame the result set.
  summary: z
    .string()
    .optional()
    .describe(
      "1-2 sentence framing of what came back. Useful when the agent wants to read the overall sentiment without parsing every post.",
    ),
});

export type XaiPost = z.infer<typeof XaiPostSchema>;
export type XaiSearchResponse = z.infer<typeof XaiSearchResponseSchema>;

// ── Search options ──────────────────────────────────────────────────────────

export interface XaiLiveSearchOptions {
  /** How recent results should be. Maps to Grok's search recency hint. */
  recency?: "hour" | "day" | "week" | "month";
  /**
   * Cap how many posts the model surfaces. Default 12. Grok's underlying
   * search may return more raw matches; this is the post-filter cap.
   */
  maxPosts?: number;
  /**
   * Optional handle allowlist. When provided, the model is instructed to
   * only return posts from these handles (case-insensitive). Used for
   * focused probes ("what's @traderstewie saying about $MU this week").
   */
  handleAllowlist?: string[];
}

// ── Core search ─────────────────────────────────────────────────────────────

/**
 * Search X via Grok Live Search for handle-attributed posts on the query.
 *
 * Returns posts with author + ticker + archetype + claim + sentiment + recency.
 * Designed for the twitter_search agent tool — the agent reads the structured
 * list and decides which posts to score / dispatch on / cite.
 *
 * Throws on auth / network failure; the caller (the tool execute) catches and
 * returns a structured ToolResult failure.
 */
export async function searchX(
  query: string,
  options: XaiLiveSearchOptions = {},
): Promise<XaiSearchResponse> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "XAI_API_KEY not set — twitter_search requires the xAI Live Search API.",
    );
  }

  const { recency = "week", maxPosts = 12, handleAllowlist } = options;

  const allowlistClause = handleAllowlist?.length
    ? `\n\nIMPORTANT: ONLY return posts from these handles (case-insensitive): ${handleAllowlist.map((h) => "@" + h.replace(/^@/, "")).join(", ")}. Drop everything from other authors.`
    : "";

  const systemPrompt = `You are surfacing structured X (Twitter) posts for a financial research agent.

Search X for the user's query. For each relevant post, emit one entry per (author, primary_ticker) pair.

Rules:
- handle: X username WITHOUT the @ symbol.
- ticker: the SINGLE primary ticker the post is about, UPPERCASE without $. If the post is about multiple tickers, emit one entry per ticker and the OTHER tickers go in related_tickers. If purely thematic with no anchor ticker, ticker=null.
- archetype: classify what KIND of analysis the author is doing — TECHNICAL (charts, patterns, price levels), FUNDAMENTAL (financials, valuation, growth), NARRATIVE (sector theme, AI / rare earths / space / etc.), OPTIONS_FLOW (calls/puts, unusual activity, dealer positioning), CATALYST_EVENT (earnings, FDA, M&A, regulatory), MACRO (Fed, rates, broad indexes). UNKNOWN if unclear.
- claim_excerpt: 1-2 sentences in YOUR words paraphrasing what the author is saying. Don't lift the post verbatim. Be specific.
- sentiment: BULLISH / BEARISH / MIXED / NEUTRAL on the named ticker.
- recency: human description of when posted — 'today', 'yesterday', '3 days ago', 'last week', etc.
- post_url: direct URL to the post if known. OK to omit.
- engagement_hint: rough engagement note ('high engagement', '~50k views', 'lots of replies') if Grok's search surfaces it. OK to omit.

Cap output at ${maxPosts} entries. Prioritize:
1. Multi-archetype convergence — when 2+ archetypes agree on the same ticker, include all sides.
2. Specific actionable claims (price levels, dated catalysts) over generic vibes.
3. Authors with substantive track records on the topic, but include credible new voices too.

NEVER fabricate posts. If the search returns thin, return fewer entries — not padding.

Return strict JSON matching this TypeScript shape:
{
  "posts": Array<{
    "handle": string,
    "display_name"?: string,
    "ticker": string | null,
    "related_tickers": string[],
    "archetype": "TECHNICAL" | "FUNDAMENTAL" | "NARRATIVE" | "OPTIONS_FLOW" | "CATALYST_EVENT" | "MACRO" | "UNKNOWN",
    "claim_excerpt": string,
    "sentiment": "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL",
    "recency": string,
    "post_url"?: string,
    "engagement_hint"?: string
  }>,
  "summary"?: string
}${allowlistClause}`;

  const body = {
    model: XAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
    response_format: { type: "json_object" },
    // xAI-specific — not in the OpenAI SDK types. Passed as raw JSON.
    search_parameters: {
      mode: "on",
      sources: [{ type: "x" }],
      max_search_results: Math.max(maxPosts * 2, 20),
      // recency hint is currently advisory in Grok's Live Search; xAI maps
      // it to a from_date roughly equivalent to the window.
      ...(recency && { recency }),
    },
    max_tokens: 4096,
    temperature: 0.2,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), XAI_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `xAI Live Search HTTP ${response.status}: ${errText.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return { posts: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error(
      "[xai-live-search] Failed to parse response as JSON:",
      content.slice(0, 200),
      err,
    );
    return { posts: [] };
  }

  const result = XaiSearchResponseSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(
      "[xai-live-search] Response did not match schema:",
      result.error.issues.slice(0, 3),
    );
    // Best-effort: keep whatever posts validated individually.
    const rawPosts = (parsed as { posts?: unknown[] })?.posts ?? [];
    const validPosts: XaiPost[] = [];
    for (const p of rawPosts) {
      const ok = XaiPostSchema.safeParse(p);
      if (ok.success) validPosts.push(ok.data);
    }
    return {
      posts: validPosts,
      summary: (parsed as { summary?: string })?.summary,
    };
  }

  return result.data;
}
