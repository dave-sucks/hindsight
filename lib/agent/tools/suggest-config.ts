/**
 * suggest_config tool — one schema per mode. The builder's names a playbook
 * and carries the words and the watchlist: the tool fills in the playbook's
 * setups, hold, confidence, slots and fence (playbookFields), and the money
 * and direction start from NEW_ANALYST_DEFAULTS (lib/analyst-settings.ts).
 * The owner changes any of them on the panel. The editor's (and the chat's)
 * carries every field, the money only when the owner names an amount, and a
 * market-cap bound it can clear with null. The field rows are in
 * field-contract.ts.
 *
 * Returns the config object as-is. The UI side reads the tool call args
 * (via the ToolCallRow config-preview renderer) to render a preview card.
 */

import { tool } from "ai";
import { z } from "zod";
import { SECTORS, INDUSTRIES } from "@/lib/universe/canonical";
import { SETUP_IDS } from "@/lib/agent/knowledge/setups";
import { NEW_ANALYST_NUMBERS } from "@/lib/analyst-settings";
import { STRATEGY_ARCHETYPES, playbookFields } from "@/lib/agent/knowledge/strategy-archetypes";

export type SuggestConfigMode = "builder" | "editor";

// z.enum needs a non-empty tuple literal; derive one from the canonical lists.
const SECTOR_VALUES = [...SECTORS] as [string, ...string[]];
const INDUSTRY_VALUES = [...INDUSTRIES] as [string, ...string[]];
const PLAYBOOK_IDS = STRATEGY_ARCHETYPES.map((a) => a.id) as [string, ...string[]];

// ── Normalizer: the editor's market-cap sentinels, before Zod runs ──────────
// A market cap of 0, or a ceiling of $5T or more, is the model saying "no
// bound": the editor clears it (null).
function normalizeEditorConfig(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const cfg: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  if (cfg.marketCapMin === 0) cfg.marketCapMin = null;
  if (cfg.marketCapMax === 0 || (typeof cfg.marketCapMax === "number" && cfg.marketCapMax >= 5e12)) cfg.marketCapMax = null;
  return cfg;
}

// The words and the watchlist: the model writes these in both modes.
const wordsShape = {
  name: z.string().describe("Short analyst name (2-4 words). E.g. 'EV Momentum Trader'"),
  analystPrompt: z
    .string()
    .describe(
      "The strategy every run reads, in seven parts: the edge, what counts, what it skips, when it buys, when it's done, how it sizes (in words), and what it never does. " +
      "No number a setting, setup or account rule owns: no stop or target percent, no confidence, no slot count, no trade size."
    ),
  description: z
    .string()
    .optional()
    .describe("One line for display, in the shape 'Buys … long-only. Holds …; sells when …'. E.g. 'Buys clean beat-and-raise earnings prints long-only. Holds weeks for the drift; sells when the drift fades or before the next print.'"),
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

// The style: the builder takes these from the playbook; the editor changes them on the owner's word.
const styleShape = {
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
  ...wordsShape,
  ...styleShape,
  marketCapMin: clearableCap("Minimum market cap"),
  marketCapMax: clearableCap("Maximum market cap"),
  minPositionSize: ownerAmount("The smallest trade", 0),
  maxPositionSize: ownerAmount("The largest trade", 100),
};

// The builder names a playbook and writes the words; the style comes from the playbook.
const builderShape = {
  playbook: z
    .enum(PLAYBOOK_IDS)
    .describe("The playbook this analyst is built from (read_knowledge_library topic:'archetype'). Its setups, hold, confidence, slots and any fence its edge needs come with it."),
  ...wordsShape,
};

export const builderConfigSchema = z.object(builderShape);
export const editorConfigSchema = z.preprocess(normalizeEditorConfig, z.object(editorShape));

/** The suggest_config tool for a mode: the builder's makes an analyst, the editor's changes one. */
export function suggestConfigFor(mode: SuggestConfigMode) {
  return mode === "builder"
    ? tool({
        description:
          "Propose the new analyst: name the playbook and write the name, description, strategy and watchlist. The playbook's setups, hold, confidence, slots and fence come with it, and the money and direction start from the defaults; the owner changes any of them on the panel.",
        inputSchema: builderConfigSchema,
        // The proposal the panel shows and Create saves: the model's words with the playbook's style.
        execute: async (config) => ({ ...config, ...playbookFields(config.playbook) }),
      })
    : tool({
        description:
          "Suggest the analyst's updated configuration: call this with the full updated config (all fields), and the money only when the owner names an amount.",
        inputSchema: editorConfigSchema,
        execute: async (config) => config,
      });
}
