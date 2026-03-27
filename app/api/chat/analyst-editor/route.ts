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
    .array(
      z.object({
        symbol: z.string().describe("Ticker symbol, e.g. NVDA"),
        reason: z.string().describe("Why this stock should be watched"),
        priority: z.enum(["HIGH", "NORMAL", "LOW"]).optional(),
      }),
    )
    .optional()
    .describe("Watchlist with structured tracking. Each item has a reason and priority."),
  exclusionList: z
    .array(z.string())
    .optional()
    .describe("Tickers to never trade."),
  // Intelligence monitors — domain sources and search queries
  sourcePackProposal: z
    .object({
      name: z.string().describe("Monitor group name, e.g. 'EV Industry Monitors'"),
      sources: z
        .array(
          z.object({
            name: z.string().describe("Source name, e.g. 'Electrek', 'InsideEVs', 'CNBC Autos'"),
            domain: z.string().describe("Source domain, e.g. 'electrek.co', 'insideevs.com'"),
            category: z.enum(["MARKET", "SECTOR", "COMPANY", "THEMATIC", "SOCIAL", "EVENT"]).describe("Source category"),
            qualityScore: z.number().min(1).max(5).describe("Source quality 1-5. Tier-1 financial press = 5, niche blogs = 2-3, social = 1-2"),
            reason: z.string().describe("Why this source matters for this analyst's strategy"),
          })
        )
        .min(4)
        .max(6)
        .describe("4-6 domain monitors — websites the system checks daily for this analyst."),
    })
    .optional()
    .describe("Domain monitors: 4-6 websites the intelligence pipeline monitors daily. Each becomes a domain monitor that searches the site for new content and routes findings to the analyst."),
  intelligenceQueries: z
    .array(
      z.object({
        query: z.string().describe("A specific, searchable query"),
        category: z.enum(["MARKET", "SECTOR", "TICKER", "THEMATIC", "EVENT"]).describe("Query category"),
        reason: z.string().describe("Why this query matters for the analyst's strategy"),
      })
    )
    .min(3)
    .max(5)
    .optional()
    .describe("Search monitors: 3-5 queries the system searches daily. Think: what would this analyst Google every morning before the market opens?"),
  intelligencePolicy: z
    .object({
      holdingsAttention: z.number().min(0).max(1).describe("Weight for signals about current positions"),
      watchlistAttention: z.number().min(0).max(1).describe("Weight for watchlist signals"),
      discoveryAttention: z.number().min(0).max(1).describe("Weight for new opportunity signals"),
      maxSignalsPerRun: z.number().min(10).max(100).optional().describe("Max signals per run. Default 30"),
      maxArtifactReads: z.number().min(2).max(20).optional().describe("Max full article reads per run. Default 5"),
      allowLiveSearch: z.boolean().optional().describe("Whether the agent can do live web searches. Default true"),
      liveSearchBudget: z.number().min(0).max(20).optional().describe("Max live search calls per run. Default 5"),
    })
    .optional()
    .describe("Intelligence policy tuned to the analyst's strategy. The three attention weights should sum to ~1.0."),
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

## Available Research Tools (same tools the agent uses during live runs)
- **get_market_context** — SPY, VIX, 11 sector ETFs, regime classification, macro events, earnings density
- **get_stock_data** — Comprehensive: price quote, company profile, financials, technicals (RSI/SMA/52W), analyst consensus, price targets, news
- **get_earnings_data** — Upcoming earnings date, EPS estimates, beat rate, recent quarters

Use these tools when the user's request benefits from current market context, but you don't need to use them for straightforward config changes.

## Intelligence Layer
The analyst has an intelligence layer: background monitors that search the web daily and route findings to the agent before each run.
- **sourcePackProposal**: 4-6 domain monitors (websites). Think: what sources would a real analyst at this desk read every morning?
- **intelligenceQueries**: 3-5 standing search queries. Think: what would this analyst Google before the market opens?
- **intelligencePolicy**: Attention weights (holdingsAttention, watchlistAttention, discoveryAttention — sum to ~1.0) and budgets.

When the user asks to "set up intelligence" or "add monitoring" or "what sources should this analyst watch", propose domain monitors and search queries tailored to their specific strategy. If the analyst has no intelligence config yet, proactively suggest setting it up.

## Key Rules
- ALWAYS include ALL fields when calling suggest_config — it replaces the entire config
- The analystPrompt must be COMPLETE (not a diff) — at least 3-5 paragraphs
- When only changing numeric params (confidence, position size), keep the analystPrompt unchanged
- Intelligence fields (sourcePackProposal, intelligenceQueries, intelligencePolicy) are OPTIONAL — only include them when specifically setting up or changing intelligence monitoring
- Explain trade-offs before making changes — don't just blindly do what's asked
- If the user's change seems counterproductive, respectfully push back with reasoning`;
}

// ── Route ───────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? "";

    const { messages, currentConfig } = await req.json();

    const modelMessages = await convertToModelMessages(messages);
    const systemPrompt = buildEditorSystemPrompt(currentConfig ?? {});

    // ── Use the SAME research tools as the agent ─────────────────────────
    const agentTools = createAgentTools({
      runId: "editor",
      userId,
    });

    const {
      get_market_context,
      get_stock_data,
      get_earnings_data,
    } = agentTools;

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

        // Agent research tools (same data, same format, same domain cards)
        get_market_context,
        get_stock_data,
        get_earnings_data,
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
