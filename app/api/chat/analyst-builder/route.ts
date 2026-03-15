import { streamText, tool, stepCountIs, convertToModelMessages } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createResearchTools as createAgentTools } from "@/lib/agent/tools";

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
- ALWAYS call **get_market_overview** first to see what's happening right now (SPY, VIX, sector ETFs)
- ALWAYS call **scan_candidates** to find real trading candidates (earnings, movers, trending)
- Use **get_stock_data** on 1-2 specific tickers that fit the emerging strategy — shows quote, financials, news, analyst ratings
- Use **get_earnings_data** to find stocks with upcoming or recent earnings
- Use **get_reddit_sentiment** to see what retail traders are buzzing about
- Use **search_reddit** to search Reddit for broader topics or trends (e.g. "biotech FDA", "momentum plays")
- Use **get_news_deep_dive** to find relevant news for specific tickers
- Share your findings naturally: "I just looked at the market and noticed X... that aligns with your interest in Y"
- Propose specific angles: "What if instead of just momentum, we focused on post-earnings momentum in semis? Here's why..."
- Challenge assumptions: "You said LONG only, but some of the best setups in biotech are actually short after failed trials..."

CRITICAL: Do NOT call suggest_config until you have called at least get_market_overview AND one other research tool. The user is paying for real research, not generic advice.

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

## Available Research Tools (same tools the agent uses during live runs)
- **get_market_overview**: Get current SPY, VIX, and sector ETF performance. Always call this first.
- **scan_candidates**: Scan for trading candidates — earnings calendar, market movers, Reddit trending, social trends. Returns scored tickers.
- **get_stock_data**: Comprehensive stock data — price quote, company profile, key financials, analyst ratings, recent news. This is your primary research tool.
- **get_earnings_data**: Get upcoming and recent earnings data for specific tickers — EPS, beat rates, calendar.
- **get_technical_analysis**: Technical indicators — RSI-14, SMA-20/50, 52-week range, volume analysis.
- **get_reddit_sentiment**: Reddit sentiment for a specific ticker from r/wallstreetbets, r/stocks, r/options, r/investing.
- **search_reddit**: Search Reddit trading communities by topic or keyword (e.g. "biotech FDA", "semiconductor earnings"). Broader than ticker-specific sentiment.
- **get_news_deep_dive**: Deep dive into news for a ticker — press releases, headlines, analysis.
- **get_company_peers**: Compare a stock to its peers.
- **get_analyst_targets**: Analyst consensus price targets for a ticker.
- **get_sec_filings**: Recent SEC filings for a ticker.

Use these tools proactively during the brainstorming phase! Don't wait for the user to ask. Show them you're doing real research to help build the best possible strategy.

### How to Use Research Tools Effectively
1. **Start with market overview**: Call get_market_overview early to see what's happening today
2. **Scan for candidates**: Use scan_candidates to find real movers and upcoming earnings
3. **Deep dive on stocks**: Use get_stock_data when mentioning specific tickers — shows price, financials, news, analyst ratings
4. **Check earnings**: Use get_earnings_data to find stocks with upcoming/recent earnings
5. **Reddit sentiment**: Use get_reddit_sentiment for specific tickers, search_reddit for broader topics

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
- NEVER call suggest_config without first calling at least get_market_overview + one other research tool
- Always call suggest_config with ALL required fields filled in
- The analystPrompt field is the MOST important — make it thorough and specific
- Be conversational and enthusiastic — push the user to think deeper
- This is paper trading (simulated) — remind users if they seem confused about real money
- Use your research tools during brainstorming — don't just ask questions, bring data to the conversation
- If the user is vague or says "just do it", that's your cue to research MORE, not less — show them what the market looks like and build a strategy grounded in real data`;

// ── Route ───────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
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

    // ── Use the SAME research tools as the agent ─────────────────────────
    // These are the real Finnhub/FMP tools that produce domain card data.
    // We pass a dummy runId since builder doesn't have a run (tools only use it for logging).
    const agentTools = createAgentTools({
      runId: "builder",
      userId,
    });

    // Cherry-pick data-fetching tools (no DB writes, no trade execution)
    const {
      get_market_overview,
      scan_candidates,
      get_stock_data,
      get_technical_analysis,
      get_earnings_data,
      get_reddit_sentiment,
      get_news_deep_dive,
      get_company_peers,
      get_analyst_targets,
      get_sec_filings,
      // Exclude: show_thesis, place_trade, summarize_run (need real run context)
      // Exclude: get_options_flow, get_twitter_sentiment (less useful for builder)
    } = agentTools;

    const result = streamText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages: modelMessages,
      tools: {
        // Builder-only tool
        suggest_config: tool({
          description:
            "Suggest a complete analyst configuration. Call this when you have enough information to build a thorough config with a detailed strategy prompt.",
          inputSchema: configSchema,
          execute: async (config) => {
            return config;
          },
        }),

        // Agent research tools (same data, same format, same domain cards)
        get_market_overview,
        scan_candidates,
        get_stock_data,
        get_technical_analysis,
        get_earnings_data,
        get_reddit_sentiment,
        get_news_deep_dive,
        get_company_peers,
        get_analyst_targets,
        get_sec_filings,

        // Reddit topic search (uses shared lib/reddit.ts client)
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
