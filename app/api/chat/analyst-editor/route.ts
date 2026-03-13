import { streamText, tool, stepCountIs, convertToModelMessages } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const maxDuration = 120;

// ── Tool schemas ────────────────────────────────────────────────────────────────

const configSchema = z.object({
  name: z.string().describe("Short analyst name (2-4 words). E.g. 'EV Momentum Trader'"),
  analystPrompt: z
    .string()
    .describe(
      "The COMPLETE updated strategy prompt (at least 3-5 paragraphs). " +
      "This replaces the current analystPrompt entirely — include everything, not just changes."
    ),
  description: z
    .string()
    .optional()
    .describe("One-line description for display. E.g. 'Aggressive day trader focused on EV catalysts'"),
  directionBias: z
    .enum(["LONG", "SHORT", "BOTH"])
    .describe("LONG = only buy, SHORT = only short-sell, BOTH = either direction"),
  holdDurations: z
    .array(z.enum(["DAY", "SWING", "POSITION"]))
    .min(1)
    .describe("DAY = close same day, SWING = hold 2-10 days, POSITION = hold weeks+"),
  sectors: z
    .array(z.string())
    .describe("Sector filters. Empty = all sectors"),
  signalTypes: z
    .array(z.string())
    .describe("Preferred signals. Options: MOMENTUM, EARNINGS_BEAT, SECTOR_ROTATION, MEAN_REVERSION, BREAKOUT, NEWS_CATALYST, TECHNICAL, INSIDER, UNUSUAL_OPTIONS_FLOW, EARNINGS_WHISPERS"),
  minConfidence: z
    .number()
    .min(40)
    .max(95)
    .describe("Minimum confidence score (0-100) to auto-place a paper trade"),
  maxPositionSize: z
    .number()
    .min(100)
    .max(10000)
    .describe("Maximum dollar amount per trade. Paper money."),
  maxOpenPositions: z
    .number()
    .min(1)
    .max(20)
    .describe("Maximum simultaneous open trades"),
  minMarketCapTier: z
    .enum(["LARGE", "MID", "SMALL"])
    .describe("Minimum market cap. LARGE = $10B+, MID = $2-10B, SMALL = <$2B"),
  watchlist: z
    .array(z.string())
    .optional()
    .describe("Explicit tickers to always analyze. Leave empty for discovery mode."),
  exclusionList: z
    .array(z.string())
    .optional()
    .describe("Tickers to never trade."),
});

// ── System prompt ───────────────────────────────────────────────────────────────

function buildEditorSystemPrompt(currentConfig: Record<string, unknown>): string {
  return `You are the Analyst Editor for Hindsight, an AI-powered paper trading platform.

Your job: help users REFINE and IMPROVE an existing trading analyst configuration. You deeply understand the current strategy and help users make targeted, intelligent changes.

## Your Personality
You're like a senior PM reviewing a junior analyst's strategy with them. You understand nuance — when they say "make it more aggressive" you know that could mean lower confidence threshold, tighter stops, or shifting to momentum signals. You always explain the TRADE-OFFS of any change.

## Current Configuration
\`\`\`json
${JSON.stringify(currentConfig, null, 2)}
\`\`\`

## How to Work

### Answering Questions
When the user asks about the current strategy, give clear, insightful answers:
- "What's this analyst good at?" → analyze the strategy prompt, sectors, and signals
- "Why might it be underperforming?" → look for gaps, conflicting settings, or market mismatches
- "Is the confidence threshold too high?" → explain the trade-off: fewer but higher-quality trades vs. more trades

### Making Changes
When the user wants modifications:
1. **Acknowledge the change** — "You want to add biotech to the sector filter"
2. **Explain the impact** — "This means the scanner will also evaluate biotech stocks. Given your current signal types (MOMENTUM, EARNINGS_BEAT), this pairs well since biotech has frequent earnings catalysts."
3. **Call suggest_config** with the COMPLETE updated config. The analystPrompt must be the FULL strategy document with your changes woven in — not just the delta.

### Strategy Prompt Edits
The analystPrompt (strategy document) is the most important field. When editing it:
- Preserve the parts that are working well
- Weave in new instructions naturally — don't just append
- Maintain the voice and style of the original
- The updated prompt should read as a cohesive strategy document, not a patchwork
- Always output the COMPLETE prompt, not just the changed sections

### Proactive Suggestions
When you notice potential improvements, suggest them:
- "Your analyst uses MOMENTUM signals but has POSITION hold duration — those can conflict"
- "With a 90% confidence threshold, your analyst might not place many trades. Consider 75-80% for more activity"
- "You're scanning all sectors but your strategy prompt only discusses tech — consider narrowing sectors or broadening the prompt"

## Available Research Tools
- **web_search**: Search for current market news or strategy insights to inform your editing recommendations
- **get_market_context**: Get current SPY, VIX, and sector performance to contextualize changes
- **search_reddit**: Check Reddit sentiment to validate or challenge strategy changes

Use these tools when the user's request benefits from current market context, but you don't need to use them for straightforward config changes.

## Key Rules
- ALWAYS include ALL fields when calling suggest_config — it replaces the entire config
- The analystPrompt must be COMPLETE (not a diff) — at least 3-5 paragraphs
- When only changing numeric params (confidence, position size), keep the analystPrompt unchanged
- Explain trade-offs before making changes — don't just blindly do what's asked
- If the user's change seems counterproductive, respectfully push back with reasoning`;
}

// ── Helpers for research tools ──────────────────────────────────────────────────

const FMP_KEY = process.env.FMP_API_KEY ?? "";
const FINNHUB_KEY = process.env.FINNHUB_API_KEY ?? "";

async function fetchJSON(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Route ───────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { messages, currentConfig } = await req.json();

    const modelMessages = await convertToModelMessages(messages);
    const systemPrompt = buildEditorSystemPrompt(currentConfig ?? {});

    const result = streamText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages: modelMessages,
      tools: {
        suggest_config: tool({
          description:
            "Suggest an updated analyst configuration. Call this with the COMPLETE config (all fields) after explaining the changes and their trade-offs.",
          inputSchema: configSchema,
          execute: async (config) => {
            return config;
          },
        }),

        web_search: tool({
          description:
            "Search the web for current market news or strategy insights to inform editing recommendations.",
          inputSchema: z.object({
            query: z.string().describe("Search query — be specific"),
          }),
          execute: async ({ query }) => {
            try {
              const newsUrl = `https://financialmodelingprep.com/api/v3/stock_news?limit=10&apikey=${FMP_KEY}`;
              const stockNewsUrl = `https://financialmodelingprep.com/api/v3/fmp/articles?page=0&size=10&apikey=${FMP_KEY}`;

              const [news, articles] = await Promise.all([
                fetchJSON(newsUrl),
                fetchJSON(stockNewsUrl),
              ]);

              const results: Array<{ title: string; text: string; url: string; source: string }> = [];

              if (Array.isArray(news)) {
                for (const n of news.slice(0, 5)) {
                  if (
                    n.title?.toLowerCase().includes(query.split(" ")[0]?.toLowerCase()) ||
                    n.text?.toLowerCase().includes(query.split(" ")[0]?.toLowerCase()) ||
                    results.length < 3
                  ) {
                    results.push({
                      title: n.title ?? "",
                      text: (n.text ?? "").slice(0, 200),
                      url: n.url ?? "",
                      source: n.site ?? "FMP",
                    });
                  }
                }
              }

              if (Array.isArray(articles?.content)) {
                for (const a of articles.content.slice(0, 3)) {
                  results.push({
                    title: a.title ?? "",
                    text: (a.content ?? "").slice(0, 200),
                    url: a.link ?? "",
                    source: "FMP Analysis",
                  });
                }
              }

              return {
                query,
                results: results.slice(0, 6),
                _sources: results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  provider: r.source,
                  excerpt: r.text,
                })),
              };
            } catch {
              return { query, results: [], error: "Search unavailable" };
            }
          },
        }),

        get_market_context: tool({
          description:
            "Get current market conditions: SPY performance, VIX level, and sector performance.",
          inputSchema: z.object({}),
          execute: async () => {
            try {
              const [spyQuote, sectorData] = await Promise.all([
                fetchJSON(
                  `https://financialmodelingprep.com/api/v3/quote/SPY?apikey=${FMP_KEY}`,
                ),
                fetchJSON(
                  `https://financialmodelingprep.com/api/v3/sectors-performance?apikey=${FMP_KEY}`,
                ),
              ]);

              const vixQuote = await fetchJSON(
                `https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB_KEY}`,
              );

              const spy = Array.isArray(spyQuote) ? spyQuote[0] : null;

              return {
                spy: spy
                  ? {
                      price: spy.price,
                      change: spy.changesPercentage,
                      dayRange: `${spy.dayLow} - ${spy.dayHigh}`,
                    }
                  : null,
                vix: vixQuote?.c
                  ? { level: vixQuote.c, change: vixQuote.dp }
                  : null,
                sectors: Array.isArray(sectorData)
                  ? sectorData.slice(0, 11).map((s: Record<string, unknown>) => ({
                      sector: s.sector,
                      change: s.changesPercentage,
                    }))
                  : [],
                timestamp: new Date().toISOString(),
              };
            } catch {
              return { error: "Market data unavailable" };
            }
          },
        }),

        search_reddit: tool({
          description:
            "Search Reddit trading communities for sentiment — useful for validating strategy changes.",
          inputSchema: z.object({
            query: z.string().describe("Search query for Reddit"),
          }),
          execute: async ({ query }) => {
            try {
              const subreddits = ["wallstreetbets", "stocks", "options", "investing"];
              const results: Array<{
                subreddit: string;
                title: string;
                score: number;
                url: string;
              }> = [];

              await Promise.all(
                subreddits.map(async (sub) => {
                  try {
                    const res = await fetch(
                      `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=week&limit=3`,
                      {
                        headers: { "User-Agent": "Hindsight/1.0" },
                        signal: AbortSignal.timeout(5000),
                      },
                    );
                    if (!res.ok) return;
                    const data = await res.json();
                    const posts = data?.data?.children ?? [];
                    for (const post of posts) {
                      const d = post.data;
                      results.push({
                        subreddit: sub,
                        title: d.title ?? "",
                        score: d.score ?? 0,
                        url: `https://reddit.com${d.permalink ?? ""}`,
                      });
                    }
                  } catch {
                    /* skip */
                  }
                }),
              );

              return {
                query,
                results: results
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 8),
                _sources: results.slice(0, 8).map((r) => ({
                  title: r.title,
                  url: r.url,
                  provider: `r/${r.subreddit}`,
                  excerpt: `Score: ${r.score}`,
                })),
              };
            } catch {
              return { query, results: [], error: "Reddit search unavailable" };
            }
          },
        }),
      },
      stopWhen: stepCountIs(10),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[analyst-editor] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
