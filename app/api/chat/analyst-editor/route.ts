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

## Available Research Tools (same tools the agent uses during live runs)
- **get_market_overview**: Get current SPY, VIX, and sector ETF performance
- **get_stock_data**: Comprehensive stock data — price, company profile, financials, analyst ratings, news
- **get_earnings_data**: Upcoming and recent earnings data
- **get_reddit_sentiment**: Reddit sentiment for a specific ticker from major trading communities
- **search_reddit**: Search Reddit by topic or keyword (e.g. "biotech FDA", "semiconductor earnings")
- **get_news_deep_dive**: Deep dive into news for a ticker

Use these tools when the user's request benefits from current market context, but you don't need to use them for straightforward config changes.

## Key Rules
- ALWAYS include ALL fields when calling suggest_config — it replaces the entire config
- The analystPrompt must be COMPLETE (not a diff) — at least 3-5 paragraphs
- When only changing numeric params (confidence, position size), keep the analystPrompt unchanged
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
      get_market_overview,
      detect_market_themes,
      get_stock_data,
      get_earnings_data,
      get_reddit_sentiment,
      get_news_deep_dive,
      search_reddit,
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
        get_market_overview,
        detect_market_themes,
        get_stock_data,
        get_earnings_data,
        get_reddit_sentiment,
        get_news_deep_dive,
        search_reddit,
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
