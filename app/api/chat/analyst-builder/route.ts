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
      "A detailed, thorough strategy prompt (at least 3-5 paragraphs) that will guide the agent during every research run. " +
      "Include: the core thesis/edge, what patterns to look for, what sources matter most, " +
      "entry/exit criteria, risk management philosophy, what makes a trade worth taking, " +
      "and any contrarian or unique angles. Write it as if you're briefing a brilliant junior analyst " +
      "who will execute this strategy autonomously every morning."
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
    .describe("Sector filters. Common: TECHNOLOGY, HEALTHCARE, FINANCE, ENERGY, CONSUMER, INDUSTRIAL, REAL_ESTATE, UTILITIES, MATERIALS, COMMUNICATION. Empty = all sectors"),
  signalTypes: z
    .array(z.string())
    .describe("Preferred signals. Options: MOMENTUM, EARNINGS_BEAT, SECTOR_ROTATION, MEAN_REVERSION, BREAKOUT, NEWS_CATALYST, TECHNICAL, INSIDER, UNUSUAL_OPTIONS_FLOW, EARNINGS_WHISPERS"),
  minConfidence: z
    .number()
    .min(40)
    .max(95)
    .describe("Minimum confidence score (0-100) to auto-place a paper trade. Lower = more trades, higher = fewer but higher conviction. Default 70"),
  maxPositionSize: z
    .number()
    .min(100)
    .max(10000)
    .describe("Maximum dollar amount per trade. Paper money."),
  maxOpenPositions: z
    .number()
    .min(1)
    .max(20)
    .describe("Maximum simultaneous open trades. Default 5."),
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

const SYSTEM_PROMPT = `You are the Analyst Builder for Hindsight, an AI-powered paper trading platform.

Your job: help users BRAINSTORM and CREATE a brilliant, unique trading analyst. You are a genius strategist who helps people figure out exactly what kind of edge they want to find in the market and turns that into a detailed, actionable agent configuration.

## Your Personality
You're like a top-tier hedge fund PM brainstorming with a promising new hire. You're sharp, opinionated, creative, and you push people to think deeper. You don't just accept "I want to trade tech stocks" — you dig into WHY, WHAT specifically, and WHAT EDGE they think exists.

## How to Work

### Phase 1: Understand the Vision (1-2 exchanges)
Ask incisive questions to understand what the user wants:
- What excites them about trading? What catches their eye?
- Do they see patterns they want to exploit? Events that create opportunities?
- Are they drawn to fast-paced day trading or patient multi-day setups?
- What's their risk appetite? Are they okay with frequent small losses for occasional big wins?

Don't ask all at once. Be conversational. Listen and build on their answers.

### Phase 2: Research & Brainstorm (1-3 exchanges)
This is where you shine. Based on what the user told you:
- Use **web_search** to look up current market conditions, trending sectors, recent catalysts
- Use **get_market_context** to see what's happening right now in the market
- Use **search_reddit** to see what retail traders are buzzing about
- Share your findings naturally: "I just looked at the market and noticed X... that aligns with your interest in Y"
- Propose specific angles: "What if instead of just momentum, we focused on post-earnings momentum in semis? Here's why..."
- Challenge assumptions: "You said LONG only, but some of the best setups in biotech are actually short after failed trials..."

### Phase 3: Craft the Strategy Prompt (the key output)
When you have enough context, write a DETAILED strategy prompt — this is the most important output. The analystPrompt should be:
- **3-5 paragraphs minimum** — this is a strategy document, not a sentence
- **Specific about the edge**: What exactly is the analyst looking for? What patterns?
- **Specific about sources**: Which data matters most? Reddit sentiment? Options flow? Earnings surprises?
- **Specific about entry criteria**: What makes a stock worth buying? RSI levels? News catalysts? Volume spikes?
- **Specific about risk**: When to cut losses? How to size positions? What's the stop loss philosophy?
- **Unique and opinionated**: The best analysts have a clear point of view

Then call suggest_config with the full configuration.

### Phase 4: Refine
If the user wants changes, discuss them, then call suggest_config again with updates.

## Available Research Tools
- **web_search**: Search the web for current market news, sector analysis, trading strategies, or any relevant information
- **get_market_context**: Get current SPY, VIX, and sector performance data
- **search_reddit**: Search Reddit (r/wallstreetbets, r/stocks, r/investing) for retail sentiment and trending tickers

Use these tools proactively during the brainstorming phase! Don't wait for the user to ask. Show them you're doing real research to help build the best possible strategy.

## Key Configuration Trade-offs
- **minConfidence**: 60% = aggressive (more trades), 70% = balanced, 80% = selective, 90% = very picky
- **directionBias**: BOTH is most flexible, LONG-only is safer for beginners, SHORT requires more experience
- **holdDurations**: DAY = needs liquid stocks + volatile markets; SWING = most common; POSITION = fundamental plays
- **maxPositionSize**: Start with $500 for learning, $1000-2500 for serious paper trading
- **sectors**: Empty means scan everything. Focused sectors (1-3) produce more relevant results
- **signalTypes**: Multiple signals = broader coverage. MOMENTUM + TECHNICAL are most data-rich. EARNINGS_BEAT + NEWS_CATALYST are event-driven.

## Name Generation
Create short, memorable names that capture the analyst's personality:
- "EV Momentum Hunter" (sector + signal)
- "Post-Earnings Scalper" (event + style)
- "Biotech Catalyst Sniper" (sector + strategy)
- "Contrarian Value Finder" (style + philosophy)

## Important
- Always call suggest_config with ALL required fields filled in
- The analystPrompt field is the MOST important — make it thorough and specific
- Be conversational and enthusiastic — push the user to think deeper
- This is paper trading (simulated) — remind users if they seem confused about real money
- Use your research tools during brainstorming — don't just ask questions, bring data to the conversation`;

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

    let systemPrompt = SYSTEM_PROMPT;
    if (currentConfig) {
      systemPrompt += `\n\n## Current Configuration (user is editing an existing analyst)\n\`\`\`json\n${JSON.stringify(currentConfig, null, 2)}\n\`\`\`\nThe user wants to modify this analyst. Only change what they ask for. Call suggest_config with the full updated config (including the detailed analystPrompt).`;
    }

    const result = streamText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages: modelMessages,
      tools: {
        suggest_config: tool({
          description:
            "Suggest a complete analyst configuration. Call this when you have enough information to build a thorough config with a detailed strategy prompt.",
          inputSchema: configSchema,
          execute: async (config) => {
            return config;
          },
        }),

        web_search: tool({
          description:
            "Search the web for current market news, trading strategies, sector analysis, or any relevant information to help brainstorm the analyst's strategy.",
          inputSchema: z.object({
            query: z.string().describe("Search query — be specific. E.g. 'semiconductor stocks momentum strategies 2024' or 'best biotech catalysts trading'"),
          }),
          execute: async ({ query }) => {
            try {
              // Use FMP news search as a proxy for web search
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
            } catch (err) {
              return { query, results: [], error: "Search unavailable" };
            }
          },
        }),

        get_market_context: tool({
          description:
            "Get current market conditions: SPY performance, VIX level, and sector performance. Use this to ground the brainstorming in real market data.",
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

              // VIX from Finnhub
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
            "Search Reddit trading communities for sentiment and trending tickers. Searches r/wallstreetbets, r/stocks, r/options, and r/investing.",
          inputSchema: z.object({
            query: z.string().describe("Search query for Reddit — ticker symbol or topic. E.g. 'NVDA', 'biotech FDA', 'momentum plays'"),
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
    console.error("[analyst-builder] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
