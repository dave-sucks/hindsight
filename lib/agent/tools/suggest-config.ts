/**
 * suggest_config tool — used in builder and editor modes.
 *
 * Returns the config object as-is. The UI side reads the tool call args
 * (via the ToolCallRow config-preview renderer) to render a preview card.
 */

import { tool } from "ai";
import { z } from "zod";
import { SECTORS, INDUSTRIES } from "@/lib/universe/canonical";
import { SETUP_IDS } from "@/lib/agent/knowledge/setups";

// z.enum needs a non-empty tuple literal; derive one from the canonical lists.
const SECTOR_VALUES = [...SECTORS] as [string, ...string[]];
const INDUSTRY_VALUES = [...INDUSTRIES] as [string, ...string[]];

// ── Normalizer: strips common agent mistakes before Zod validation ──────────
// Strips sentinel zeros and oversized market-cap ceilings, which real
// editor/builder runs sent and which used to fail the whole call. Empty
// industries stay empty: a sector already means every industry in it.
function normalizeSuggestConfig(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const cfg: Record<string, unknown> = { ...(input as Record<string, unknown>) };

  // Strip sentinel 0s on market cap — agents send 0 when they mean "no floor".
  if (cfg.marketCapMin === 0) delete cfg.marketCapMin;
  if (cfg.marketCapMax === 0) delete cfg.marketCapMax;
  if (typeof cfg.marketCapMax === "number" && cfg.marketCapMax >= 5e12) {
    delete cfg.marketCapMax;
  }

  return cfg;
}

const rawConfigSchema = z.object({
  name: z.string().describe("Short analyst name (2-4 words). E.g. 'EV Momentum Trader'"),
  analystPrompt: z
    .string()
    .describe(
      "A detailed, thorough strategy prompt (at least 3-5 paragraphs) that will guide the agent during every research run. " +
      "Include: the core thesis/edge, what patterns to look for, what sources matter most, " +
      "what makes a trade worth taking, and any contrarian or unique angles. " +
      "Leave out stops, targets and position sizes: the setups, the settings and the account's rules own them. Write it as if you're briefing a brilliant junior analyst " +
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
  // The playbook patterns this analyst writes plans on (DAV-280). Read them
  // with read_knowledge_library(topic:"setup"). The FIRST is the analyst's
  // signature setup: its reviews seed the analyst's Triggers tab.
  setupIds: z
    .array(z.enum(SETUP_IDS))
    .optional()
    .describe(
      "The setups (buy patterns) this analyst runs, from read_knowledge_library(topic:'setup'). Put the signature setup FIRST — its reviews start on the analyst's Triggers tab. One to four ids. Omit = the whole playbook.",
    ),
  // Session A: sectors are enumerated against the canonical GICS Title Case
  // list. The agent literally cannot propose an unknown value — no more
  // SCREAMING_SNAKE or "Tech" strings sneaking back into AgentConfig.
  sectors: z
    .array(z.enum(SECTOR_VALUES))
    .describe(
      "Canonical GICS sectors (Title Case). One of: " +
        SECTORS.join(", ") +
        ". Empty = all sectors.",
    ),
  // ── Universe (B1) — narrower discovery fence ─────────────────────────────
  industries: z
    .array(z.enum(INDUSTRY_VALUES))
    .optional()
    .describe(
      "Canonical GICS industries (Title Case) — narrower than sector. " +
        "Pick from the canonical list; the tool call will be rejected if you " +
        "propose a value not in the list. Empty = no filter on industry.",
    ),
  themes: z
    .array(z.string())
    .optional()
    .describe(
      "Themes the strategy hunts, e.g. 'AI infrastructure', 'GLP-1', 'datacenter capex'. 3-6 is typical. " +
      "Agents read them as words; they filter nothing (sectors, industries and market cap are the fence).",
    ),
  // $10T ceiling — no company approaches this, and models like to send
  // Number.MAX_SAFE_INTEGER when they interpret "no upper bound" as a
  // sentinel instead of omitting the field. Reject at the tool layer.
  marketCapMin: z
    .number()
    .int()
    .nonnegative()
    .max(1e13)
    .optional()
    .describe(
      "Minimum market cap in dollars (integer). E.g. 500000000 for $500M. " +
      "OMIT this field entirely for no lower bound — do NOT send 0 or any sentinel. " +
      "Use with marketCapMax to define a cap band (e.g. small-caps only, large-caps only).",
    ),
  marketCapMax: z
    .number()
    .int()
    .nonnegative()
    .max(1e13)
    .optional()
    .describe(
      "Maximum market cap in dollars (integer). E.g. 10000000000 for $10B. " +
      "OMIT this field entirely for no upper bound — do NOT send Number.MAX_SAFE_INTEGER " +
      "or any absurd sentinel. If you want an implicit cap above the largest mega-cap, omit.",
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
  // Position sizing is a BAND, not a single ceiling. The floor is what stops an
  // analyst from opening a position too small to matter (a $14k-ceiling seat
  // proposing $3.5k); place_trade rejects below-floor entries outright.
  minPositionSize: z
    .number()
    .min(0)
    .max(50000)
    .optional()
    .describe(
      "Minimum dollar amount per trade — the floor of the position band. An entry below it is " +
      "REJECTED, not resized, so set it to the smallest size that still moves this analyst's book " +
      "(a common choice is ~half the ceiling). Omit or 0 for no floor.",
    ),
  maxPositionSize: z
    .number()
    .min(100)
    // 50000, not the old 10000: live conviction seats already run $15k
    // ceilings, and the old bound silently clamped any config restating one.
    .max(50000)
    .describe("Maximum dollar amount per trade — the ceiling of the position band."),
  maxOpenPositions: z
    .number()
    .min(1)
    .max(20)
    .describe("Maximum simultaneous open trades. Default 5."),
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
  // The holdings / watchlist / discovery attention weights left this object
  // with the signal router they fed (2026-09-15).
  intelligencePolicy: z
    .object({
      allowLiveSearch: z.boolean().optional(),
      liveSearchBudget: z.number().min(0).max(20).optional(),
    })
    .optional()
    .describe("Intelligence policy — the live-search budget for this analyst's runs."),
});

// Final exported schema: preprocess heals the common agent mistakes before
// rawConfigSchema runs. Order matters — normalization first, then Zod.
export const configSchema = z.preprocess(normalizeSuggestConfig, rawConfigSchema);

export type ConfigSchema = z.infer<typeof configSchema>;

/** The suggest_config tool — same in builder and editor modes. */
export const suggestConfigTool = tool({
  description:
    "Suggest a complete analyst configuration. Call this when you have enough information to build a thorough config with a detailed strategy prompt. In editor mode, call this with the full updated config (all fields).",
  inputSchema: configSchema,
  execute: async (config) => config,
});
