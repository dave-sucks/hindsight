import { streamText, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const maxDuration = 60;

// ── Tool schemas ────────────────────────────────────────────────────────────────

const configSchema = z.object({
  name: z.string().describe("Short analyst name (2-4 words). E.g. 'EV Momentum Trader'"),
  analystPrompt: z
    .string()
    .describe("Core instruction: what should this analyst find and trade?"),
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

Your job: help users create a trading analyst by having a natural conversation. Ask clarifying questions, then call the suggest_config tool with a complete configuration.

## How to Interact
1. Start by understanding what the user wants: trading style, risk tolerance, sectors of interest, time horizon.
2. Ask 1-2 focused clarifying questions at a time. Don't overwhelm with all options at once.
3. When you have enough info (usually after 1-3 exchanges), call suggest_config with a complete configuration.
4. Explain your choices briefly — especially trade-offs (e.g., "Setting confidence to 65% means more trades but lower average quality").
5. If the user wants changes, call suggest_config again with the updated values.

## Key Configuration Trade-offs
- **minConfidence**: 60% = aggressive (more trades), 70% = balanced, 80% = selective, 90% = very picky
- **directionBias**: BOTH is most flexible, LONG-only is safer for beginners, SHORT requires more experience
- **holdDurations**: DAY = needs liquid stocks + volatile markets; SWING = most common; POSITION = fundamental plays
- **maxPositionSize**: Start with $500 for learning, $1000-2500 for serious paper trading
- **sectors**: Empty means scan everything. Focused sectors (1-3) produce more relevant results
- **signalTypes**: Multiple signals = broader coverage. MOMENTUM + TECHNICAL are most data-rich. EARNINGS_BEAT + NEWS_CATALYST are event-driven.
- **minMarketCapTier**: LARGE = safer/more liquid, MID = more opportunity, SMALL = higher risk/reward

## Name Generation
Create short, descriptive names that capture the analyst's personality:
- "EV Day Trader" (sector + hold)
- "Conservative Dividend Hunter" (style + strategy)
- "Momentum Scalper" (signal + frequency)
- "Biotech Earnings Play" (sector + signal)

## Important
- Always call suggest_config with ALL required fields filled in
- Provide sensible defaults for anything the user didn't specify
- Be conversational and enthusiastic about trading — but never give real financial advice
- This is paper trading (simulated) — remind users if they seem confused about real money`;

// ── Route ───────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { messages, currentConfig } = await req.json();

  // If editing an existing analyst, include current config in context
  let systemPrompt = SYSTEM_PROMPT;
  if (currentConfig) {
    systemPrompt += `\n\n## Current Configuration (user is editing an existing analyst)\n\`\`\`json\n${JSON.stringify(currentConfig, null, 2)}\n\`\`\`\nThe user wants to modify this analyst. Only change what they ask for. Call suggest_config with the full updated config.`;
  }

  const result = streamText({
    model: openai("gpt-4o"),
    system: systemPrompt,
    messages,
    tools: {
      suggest_config: tool({
        description:
          "Suggest a complete analyst configuration based on the conversation. Call this when you have enough information to build a config, or when the user requests changes.",
        inputSchema: configSchema,
        execute: async (config) => {
          // Echo back — the frontend renders this as a ConfigPreviewCard
          return config;
        },
      }),
    },
    stopWhen: stepCountIs(3),
  });

  return result.toUIMessageStreamResponse();
}
