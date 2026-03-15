import { streamText, tool, stepCountIs, convertToModelMessages } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createResearchTools } from "@/lib/chat/tools/research-tools";

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
This is where you shine and is MANDATORY — you MUST call at least 2-3 research tools before calling suggest_config. NEVER skip this phase. Even if the user says "just do it" or "use your judgement", you MUST research first. Based on what the user told you:
- ALWAYS call **get_market_context** first to see what's happening right now
- ALWAYS call **get_trending_stocks** to show real movers that fit the strategy
- Use **get_stock_quote** on 1-2 specific tickers that fit the emerging strategy
- Use **search_reddit** to see what retail traders are buzzing about
- Share your findings naturally: "I just looked at the market and noticed X... that aligns with your interest in Y"
- Propose specific angles: "What if instead of just momentum, we focused on post-earnings momentum in semis? Here's why..."
- Challenge assumptions: "You said LONG only, but some of the best setups in biotech are actually short after failed trials..."

CRITICAL: Do NOT call suggest_config until you have called at least get_market_context AND one other research tool. The user is paying for real research, not generic advice.

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
- **get_stock_quote**: Quick quote for any ticker — price, change%, 52W range, market cap. Use when referencing a specific stock.
- **get_trending_stocks**: See today's biggest movers — gainers, losers, most active. Great for grounding brainstorming in real market action.
- **research_ticker**: Run the FULL research pipeline on a stock — generates a complete trade thesis with direction, confidence, entry/target/stop, risk flags, and reasoning. Use this to DEMONSTRATE how the strategy would work on a real stock.
- **get_thesis**: Retrieve a previously generated thesis by ticker.
- **compare_tickers**: Compare 2-3 tickers side-by-side with full research on each.
- **explain_decision**: Explain why a trade was or wasn't placed for a given ticker.

Use these tools proactively during the brainstorming phase! Don't wait for the user to ask. Show them you're doing real research to help build the best possible strategy.

### How to Use Research Tools Effectively
1. **Start with market context**: Call get_market_context early to see what's happening today
2. **Ground the conversation**: Use get_trending_stocks to show real movers that fit the strategy
3. **Quick references**: Use get_stock_quote when mentioning specific tickers — e.g. "Let me check $NVDA real quick..."
4. **Demonstrate the strategy**: When the strategy is taking shape, use research_ticker on a stock that fits — "Let me show you what this strategy would produce on NVDA right now..."
5. **Reddit sentiment**: Use search_reddit to find what retail traders are buzzing about in the relevant sector

### Formatting Guidelines
- When mentioning stock tickers in your text, use the $TICKER format (e.g. $NVDA, $AAPL, $TSLA). This renders as an interactive chip with live price data.
- When citing information from tool results, use numbered citations like [1], [2], [3]. These render as clickable badges linked to the source.
- Be specific and data-driven — reference actual prices, percentages, and metrics from tool results.

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
- NEVER call suggest_config without first calling at least get_market_context + one other research tool
- Always call suggest_config with ALL required fields filled in
- The analystPrompt field is the MOST important — make it thorough and specific
- Be conversational and enthusiastic — push the user to think deeper
- This is paper trading (simulated) — remind users if they seem confused about real money
- Use your research tools during brainstorming — don't just ask questions, bring data to the conversation
- If the user is vague or says "just do it", that's your cue to research MORE, not less — show them what the market looks like and build a strategy grounded in real data`;

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
    // ── Auth (optional — research tools need userId for DB storage) ─────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? "";

    const { messages, currentConfig } = await req.json();
    console.log(`[analyst-builder] POST messages=${messages?.length ?? 0} editing=${!!currentConfig} authed=${!!user}`);

    const modelMessages = await convertToModelMessages(messages);

    let systemPrompt = SYSTEM_PROMPT;
    if (currentConfig) {
      systemPrompt += `\n\n## Current Configuration (user is editing an existing analyst)\n\`\`\`json\n${JSON.stringify(currentConfig, null, 2)}\n\`\`\`\nThe user wants to modify this analyst. Only change what they ask for. Call suggest_config with the full updated config (including the detailed analystPrompt).`;
    }

    // ── Research tools (bound to authenticated user) ─────────────────────
    const researchTools = userId ? createResearchTools(userId) : {};

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

        // ── Inline stock tools ──────────────────────────────────────────
        get_stock_quote: tool({
          description:
            "Get a quick stock quote — current price, change%, 52W high/low, market cap. " +
            "Use when referencing a specific ticker in conversation.",
          inputSchema: z.object({
            symbol: z.string().describe("Stock ticker symbol (e.g. NVDA, AAPL)"),
          }),
          execute: async ({ symbol }) => {
            const ticker = symbol.toUpperCase();
            try {
              // Finnhub for quote + profile (FMP /quote/ is deprecated/403)
              const [fhQuote, fhProfile] = await Promise.all([
                fetchJSON(
                  `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`
                ),
                fetchJSON(
                  `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`
                ),
              ]);

              if (!fhQuote || fhQuote.c === 0) {
                return { error: `No quote data for ${ticker}` };
              }

              return {
                ticker,
                price: fhQuote.c,
                change: fhQuote.d ?? null,
                changePercent: fhQuote.dp ?? null,
                dayHigh: fhQuote.h ?? null,
                dayLow: fhQuote.l ?? null,
                previousClose: fhQuote.pc ?? null,
                yearHigh: null,
                yearLow: null,
                marketCap: fhProfile?.marketCapitalization
                  ? fhProfile.marketCapitalization * 1_000_000
                  : null,
                volume: null,
                name: fhProfile?.name ?? ticker,
                exchange: fhProfile?.exchange ?? null,
                industry: fhProfile?.finnhubIndustry ?? null,
                _sources: [
                  {
                    title: `${ticker} Quote — Finnhub`,
                    url: `https://finnhub.io/`,
                    provider: "Finnhub",
                  },
                ],
              };
            } catch {
              return { error: `Failed to fetch quote for ${ticker}` };
            }
          },
        }),

        get_trending_stocks: tool({
          description:
            "Get today's biggest stock movers — top gainers, losers, and most active by volume. " +
            "Great for grounding brainstorming in real market action.",
          inputSchema: z.object({
            category: z
              .enum(["gainers", "losers", "actives"])
              .optional()
              .describe("Which category to fetch. Defaults to gainers."),
          }),
          execute: async ({ category = "gainers" }) => {
            try {
              const url = `https://financialmodelingprep.com/api/v3/stock_market/${category}?apikey=${FMP_KEY}`;
              const data = await fetchJSON(url);

              if (!Array.isArray(data) || data.length === 0) {
                return { error: "Trending data unavailable" };
              }

              const stocks = data.slice(0, 8).map((s: Record<string, unknown>) => ({
                ticker: String(s.symbol ?? ""),
                name: String(s.name ?? ""),
                price: Number(s.price ?? 0),
                change: Number(s.change ?? 0),
                changePercent: Number(s.changesPercentage ?? 0),
              }));

              return {
                category,
                stocks,
                timestamp: new Date().toISOString(),
                _sources: [
                  {
                    title: `Top ${category.charAt(0).toUpperCase() + category.slice(1)} — FMP`,
                    url: `https://financialmodelingprep.com/market-movers`,
                    provider: "Financial Modeling Prep",
                  },
                ],
              };
            } catch {
              return { error: "Failed to fetch trending stocks" };
            }
          },
        }),

        // ── Research pipeline tools (need auth) ─────────────────────────
        ...researchTools,

        web_search: tool({
          description:
            "Search for current market news by topic or ticker. Returns recent headlines and articles.",
          inputSchema: z.object({
            query: z.string().describe("Search query — ticker symbol or topic. E.g. 'NVDA', 'semiconductor earnings', 'biotech FDA'"),
          }),
          execute: async ({ query }) => {
            try {
              // Use Finnhub general news + FMP stock news
              const [finnhubNews, fmpNews] = await Promise.all([
                fetchJSON(
                  `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`
                ),
                fetchJSON(
                  `https://financialmodelingprep.com/api/v3/stock_news?limit=10&apikey=${FMP_KEY}`
                ),
              ]);

              const results: Array<{ title: string; text: string; url: string; source: string }> = [];
              const queryLower = query.toLowerCase();

              // Finnhub general news
              if (Array.isArray(finnhubNews)) {
                for (const n of finnhubNews.slice(0, 10)) {
                  const title = String(n.headline ?? "");
                  const summary = String(n.summary ?? "");
                  if (
                    title.toLowerCase().includes(queryLower) ||
                    summary.toLowerCase().includes(queryLower) ||
                    results.length < 3
                  ) {
                    results.push({
                      title,
                      text: summary.slice(0, 200),
                      url: String(n.url ?? ""),
                      source: String(n.source ?? "Finnhub"),
                    });
                  }
                  if (results.length >= 5) break;
                }
              }

              // FMP stock news as supplement
              if (Array.isArray(fmpNews) && results.length < 6) {
                for (const n of fmpNews.slice(0, 5)) {
                  const title = String(n.title ?? "");
                  const text = String(n.text ?? "");
                  if (
                    title.toLowerCase().includes(queryLower) ||
                    text.toLowerCase().includes(queryLower) ||
                    results.length < 4
                  ) {
                    results.push({
                      title,
                      text: text.slice(0, 200),
                      url: String(n.url ?? ""),
                      source: String(n.site ?? "FMP"),
                    });
                  }
                  if (results.length >= 6) break;
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
            "Get current market conditions: SPY performance, VIX level, and sector performance. Use this to ground the brainstorming in real market data.",
          inputSchema: z.object({}),
          execute: async () => {
            try {
              // Use Finnhub for SPY + VIX (FMP /quote/ is deprecated/403)
              const [spyQuote, vixQuote, sectorData] = await Promise.all([
                fetchJSON(
                  `https://finnhub.io/api/v1/quote?symbol=SPY&token=${FINNHUB_KEY}`,
                ),
                fetchJSON(
                  `https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB_KEY}`,
                ),
                fetchJSON(
                  `https://financialmodelingprep.com/api/v3/sectors-performance?apikey=${FMP_KEY}`,
                ),
              ]);

              return {
                spy: spyQuote?.c
                  ? {
                      price: spyQuote.c,
                      change: spyQuote.dp ?? 0,
                      dayRange: `${spyQuote.l ?? "—"} - ${spyQuote.h ?? "—"}`,
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
            const { searchReddit } = await import("@/lib/reddit");
            const results = await searchReddit(query);
            return {
              query,
              results,
              _sources: results.map((r) => ({
                title: r.title,
                url: r.url,
                provider: `r/${r.subreddit}`,
                excerpt: `Score: ${r.score}`,
              })),
            };
          },
        }),
      },
      stopWhen: stepCountIs(15),
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
