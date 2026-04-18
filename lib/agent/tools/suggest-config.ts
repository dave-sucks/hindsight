/**
 * suggest_config tool — used in builder and editor modes.
 *
 * Returns the config object as-is. The UI side reads the tool call args
 * (via the ToolCallRow config-preview renderer) to render a preview card.
 */

import { tool } from "ai";
import { z } from "zod";

export const configSchema = z.object({
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
  // ── Universe (B1) — narrower discovery fence ─────────────────────────────
  industries: z
    .array(z.string())
    .optional()
    .describe(
      "GICS-style industries narrower than sector. E.g. 'Semiconductors', 'Auto Manufacturers', 'Biotechnology'. " +
      "Empty = no filter on industry. Use when the analyst's strategy is industry-specific within a broader sector.",
    ),
  themes: z
    .array(z.string())
    .optional()
    .describe(
      "Analyst-defined themes the strategy hunts. E.g. 'AI infrastructure', 'EV transition', 'GLP-1', 'datacenter capex'. " +
      "These route theme-tagged signals into the inbox. 3-6 themes is typical. Empty = no theme filter.",
    ),
  marketCapMin: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Minimum market cap in dollars (integer). E.g. 500000000 for $500M. Leave undefined for no lower bound. " +
      "Use with marketCapMax to define a cap band (e.g. small-caps only, large-caps only).",
    ),
  marketCapMax: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Maximum market cap in dollars (integer). E.g. 10000000000 for $10B. Leave undefined for no upper bound.",
    ),
  // NOTE: signalTypes was removed here because it doesn't filter anything
  // at runtime — it was a cosmetic badge field. Builder/Editor should NOT
  // propose it. The signal router cares about sectors / industries /
  // themes instead. If we ever want event-type preferences, we'll add a
  // dedicated router feature, not this orphaned field.
  minConfidence: z
    .number()
    .min(40)
    .max(95)
    .describe("Minimum confidence score (0-100) to auto-place a paper trade. Default 70"),
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
    .array(
      z.object({
        symbol: z.string().describe("Ticker symbol, e.g. NVDA"),
        reason: z.string().describe("Why this stock should be watched."),
        priority: z.enum(["HIGH", "NORMAL", "LOW"]).optional(),
      }),
    )
    .optional()
    .describe("Initial watchlist with reasons."),
  exclusionList: z
    .array(z.string())
    .optional()
    .describe("Tickers to never trade."),
  domainMonitorProposal: z
    .object({
      name: z.string().describe("Monitor group name, e.g. 'EV Industry Monitors'"),
      sources: z
        .array(
          z.object({
            name: z.string().describe("Source name, e.g. 'Electrek'"),
            domain: z.string().describe("Source domain, e.g. 'electrek.co'"),
            category: z.enum(["MARKET", "SECTOR", "COMPANY", "THEMATIC", "SOCIAL", "EVENT"]),
            qualityScore: z.number().min(1).max(5),
            reason: z.string().describe("Why this source matters for this analyst's strategy"),
          })
        )
        .min(4)
        .max(6),
    })
    .optional()
    .describe("Domain monitors: 4-6 websites the intelligence pipeline monitors daily."),
  intelligenceQueries: z
    .array(
      z.object({
        query: z.string().describe("A specific, searchable query"),
        category: z.enum(["MARKET", "SECTOR", "TICKER", "THEMATIC", "EVENT"]),
        reason: z.string().describe("Why this query matters for the analyst's strategy"),
      })
    )
    .min(3)
    .max(5)
    .optional()
    .describe("Search monitors: 3-5 queries the system searches daily via Perplexity Sonar."),
  intelligencePolicy: z
    .object({
      holdingsAttention: z.number().min(0).max(1),
      watchlistAttention: z.number().min(0).max(1),
      discoveryAttention: z.number().min(0).max(1),
      maxSignalsPerRun: z.number().min(10).max(100).optional(),
      maxArtifactReads: z.number().min(2).max(20).optional(),
      allowLiveSearch: z.boolean().optional(),
      liveSearchBudget: z.number().min(0).max(20).optional(),
    })
    .optional()
    .describe("Intelligence policy — attention weights should sum to ~1.0."),
  // Session 3: Universe — the fence for discovery routing. Tickers/signals
  // matching this Universe surface as new-ticker candidates in the morning
  // brief even when they're not in watchlist/positions. Distinct from the
  // DIRECTED-mode tickerUniverse allowlist.
  universe: z
    .object({
      sectors: z
        .array(z.string())
        .describe("High-level sector labels, e.g. TECHNOLOGY, HEALTHCARE."),
      industries: z
        .array(z.string())
        .describe("Narrower industry labels, e.g. Semiconductors, Biotech."),
      themes: z
        .array(z.string())
        .describe("Thematic tags, e.g. AI_INFRASTRUCTURE, EV_ADOPTION."),
      exchanges: z
        .array(z.string())
        .optional()
        .describe("Exchange filter, e.g. NASDAQ, NYSE. Empty = all."),
      marketCapMin: z
        .number()
        .optional()
        .describe("Minimum market cap in USD. Omit for no floor."),
      marketCapMax: z
        .number()
        .optional()
        .describe("Maximum market cap in USD. Omit for no ceiling."),
      priceMin: z
        .number()
        .optional()
        .describe("Minimum share price. Omit for no floor."),
      priceMax: z
        .number()
        .optional()
        .describe("Maximum share price. Omit for no ceiling."),
      exclusions: z
        .array(z.string())
        .optional()
        .describe("Tickers explicitly off-limits for discovery."),
    })
    .optional()
    .describe(
      "The analyst's discovery universe. Populate with sectors/industries/themes " +
      "relevant to the strategy — this is the fence for new-ticker discovery. " +
      "Keep it focused (5-10 items total); too broad makes discovery noise."
    ),
});

export type ConfigSchema = z.infer<typeof configSchema>;

/** The suggest_config tool — same in builder and editor modes. */
export const suggestConfigTool = tool({
  description:
    "Suggest a complete analyst configuration. Call this when you have enough information to build a thorough config with a detailed strategy prompt. In editor mode, call this with the full updated config (all fields).",
  inputSchema: configSchema,
  execute: async (config) => config,
});
