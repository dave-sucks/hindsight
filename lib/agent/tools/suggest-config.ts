/**
 * suggest_config tool — one schema per mode. The builder's carries no money
 * and no direction: a new analyst starts from NEW_ANALYST_DEFAULTS
 * (lib/analyst-settings.ts) and the owner changes them on the panel. The
 * editor's (and the chat's) carries the money only when the owner names an
 * amount, and a market-cap bound it can clear with null. The field rows are
 * in field-contract.ts.
 *
 * Returns the config object as-is. The UI side reads the tool call args
 * (via the ToolCallRow config-preview renderer) to render a preview card.
 */

import { tool } from "ai";
import { z } from "zod";
import { SECTORS, INDUSTRIES } from "@/lib/universe/canonical";
import { SETUP_IDS } from "@/lib/agent/knowledge/setups";
import { NEW_ANALYST_NUMBERS } from "@/lib/analyst-settings";

export type SuggestConfigMode = "builder" | "editor";

// z.enum needs a non-empty tuple literal; derive one from the canonical lists.
const SECTOR_VALUES = [...SECTORS] as [string, ...string[]];
const INDUSTRY_VALUES = [...INDUSTRIES] as [string, ...string[]];

// ── Normalizer: strips common agent mistakes before Zod validation ──────────
// A market cap of 0, or a ceiling of $5T or more, is the model saying "no
// bound": the builder leaves the field out, the editor clears it (null).
// Empty industries stay empty: a sector already means every industry in it.
const normalizeSuggestConfig = (mode: SuggestConfigMode) => (input: unknown): unknown => {
  if (!input || typeof input !== "object") return input;
  const cfg: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  const noBound = (k: string) => (mode === "editor" ? (cfg[k] = null) : delete cfg[k]);
  if (cfg.marketCapMin === 0) noBound("marketCapMin");
  if (cfg.marketCapMax === 0 || (typeof cfg.marketCapMax === "number" && cfg.marketCapMax >= 5e12)) noBound("marketCapMax");
  return cfg;
};

const sharedShape = {
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
  industries: z
    .array(z.enum(INDUSTRY_VALUES))
    .optional()
    .describe(
      "Canonical GICS industries (Title Case), narrower than a sector; a value not in the list is rejected. " +
        "The chat pinned to this analyst reads them as words when it looks for new stocks; they filter nothing (sectors, market cap and the exclusion list are the fence).",
    ),
  themes: z
    .array(z.string())
    .optional()
    .describe(
      "Themes the strategy hunts, e.g. 'AI infrastructure', 'GLP-1', 'datacenter capex'. 3-6 is typical. " +
      "The chat pinned to this analyst reads them as words when it looks for new stocks; they filter nothing (sectors, market cap and the exclusion list are the fence).",
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
    .describe("The confidence (0-100) a buy needs."),
  maxOpenPositions: z
    .number()
    .min(1)
    .max(20)
    .describe(`Maximum simultaneous open trades. Default ${NEW_ANALYST_NUMBERS.maxOpenPositions}.`),
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
};

const ownerAmount = (what: string, min: number) =>
  z
    .number()
    .min(min)
    .max(50000)
    .optional()
    .describe(`${what}, in dollars. Only when the owner names an amount; leave it out otherwise.`);
const clearableCap = (what: string) =>
  z
    .number()
    .int()
    .nonnegative()
    .max(1e13)
    .nullable()
    .optional()
    .describe(`${what} in dollars (integer). null removes the bound; leave it out to keep the current one.`);

// The editor and the chat change an analyst the owner already has: the money
// is theirs to name, and a bound can be removed.
const editorShape = {
  ...sharedShape,
  marketCapMin: clearableCap("Minimum market cap"),
  marketCapMax: clearableCap("Maximum market cap"),
  minPositionSize: ownerAmount("The smallest trade", 0),
  maxPositionSize: ownerAmount("The largest trade", 100),
};

// preprocess heals the common agent mistakes before the object runs.
export const builderConfigSchema = z.preprocess(normalizeSuggestConfig("builder"), z.object(sharedShape));
export const editorConfigSchema = z.preprocess(normalizeSuggestConfig("editor"), z.object(editorShape));

/** The suggest_config tool for a mode: the builder's makes an analyst, the editor's changes one. */
export function suggestConfigFor(mode: SuggestConfigMode) {
  return mode === "builder"
    ? tool({
        description:
          "Suggest a complete analyst configuration. Call this when you have enough information to build a thorough config with a detailed strategy prompt. It carries no money or direction: a new analyst starts long with the default trade sizes, and the owner changes them on the panel.",
        inputSchema: builderConfigSchema,
        execute: async (config) => config,
      })
    : tool({
        description:
          "Suggest the analyst's updated configuration: call this with the full updated config (all fields), and the money only when the owner names an amount.",
        inputSchema: editorConfigSchema,
        execute: async (config) => config,
      });
}
