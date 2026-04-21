/**
 * Self-improvement suggestion types.
 *
 * Every kind is a discriminated union branch on `proposedDiff.kind`. The
 * weekly Inngest job emits these; the approve path dispatches on the kind
 * and calls the matching write surface (updateAnalystField or Monitor CRUD).
 *
 * Principles (from docs/SELF_IMPROVEMENT_HANDOFF.md):
 * - Proposal, not execution. No silent writes.
 * - Every card shows evidence + proposed diff + rationale.
 * - Kinds must map cleanly to existing write surfaces — we don't invent new
 *   config shapes from the suggestion layer.
 */

import { z } from "zod";
import { SECTORS, INDUSTRIES } from "@/lib/universe/canonical";

// ── Suggestion kinds ─────────────────────────────────────────────────────────

export const SUGGESTION_KINDS = [
  "PROMPT_EDIT",
  "UNIVERSE_ADD_SECTOR",
  "UNIVERSE_REMOVE_SECTOR",
  "UNIVERSE_ADD_INDUSTRY",
  "UNIVERSE_REMOVE_INDUSTRY",
  "UNIVERSE_ADD_THEME",
  "UNIVERSE_REMOVE_THEME",
  "WATCHLIST_ADD",
  "WATCHLIST_REMOVE",
  "EXCLUSION_ADD",
  "INTELLIGENCE_QUERY_ADD",
  "INTELLIGENCE_QUERY_REMOVE",
  "META_COMMENTARY",
] as const;

export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

// ── Suggestion statuses ──────────────────────────────────────────────────────

export const SUGGESTION_STATUSES = [
  "PENDING",
  "APPROVED",
  "DISMISSED",
  "EXPIRED",
  "SNOOZED",
] as const;

export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const DISMISS_REASONS = [
  "NOT_RELEVANT",
  "ALREADY_KNOW",
  "WRONG",
  "OTHER",
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number];

export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  NOT_RELEVANT: "Not relevant",
  ALREADY_KNOW: "Already know",
  WRONG: "Wrong call",
  OTHER: "Other",
};

// ── Dedup key builder ────────────────────────────────────────────────────────
//
// Dedup strategy: one PENDING suggestion per (analyst, kind, targetKey).
// PROMPT_EDIT / META_COMMENTARY dedupe on kind alone — one outstanding at a
// time. Everything else dedupes on the target (ticker / sector / industry /
// query text). Canonical casing keeps "NVDA" and "nvda" from colliding.

export function buildDedupeKey(
  kind: SuggestionKind,
  diff: ProposedDiff,
): string {
  switch (diff.kind) {
    case "PROMPT_EDIT":
    case "META_COMMENTARY":
      return kind;
    case "UNIVERSE_ADD_SECTOR":
    case "UNIVERSE_REMOVE_SECTOR":
      return `${kind}:${diff.sector}`;
    case "UNIVERSE_ADD_INDUSTRY":
    case "UNIVERSE_REMOVE_INDUSTRY":
      return `${kind}:${diff.industry}`;
    case "UNIVERSE_ADD_THEME":
    case "UNIVERSE_REMOVE_THEME":
      return `${kind}:${diff.theme}`;
    case "WATCHLIST_ADD":
    case "WATCHLIST_REMOVE":
      return `${kind}:${diff.ticker.toUpperCase()}`;
    case "EXCLUSION_ADD":
      return `${kind}:${diff.ticker.toUpperCase()}`;
    case "INTELLIGENCE_QUERY_ADD":
      return `${kind}:${diff.query.trim().toLowerCase()}`;
    case "INTELLIGENCE_QUERY_REMOVE":
      return `${kind}:${diff.monitorId}`;
  }
}

// ── Evidence shape ───────────────────────────────────────────────────────────
//
// Persisted on Suggestion.evidence (Json). Lists the source rows the weekly
// pass saw, plus a short human-readable pattern summary. The UI renders
// dataPoints as small chips so the user can scan at a glance.

export const evidenceSchema = z.object({
  patternSummary: z
    .string()
    .describe(
      "One-sentence description of the pattern. E.g. '3 consecutive losses on $XYZ in the last 14 days' or 'Brief flagged Fed rate decision 4x without a research query that would catch it'.",
    ),
  runIds: z.array(z.string()).describe("ResearchRun IDs this pattern came from. Empty array if not run-derived."),
  tradeIds: z.array(z.string()).describe("Closed Position IDs this pattern came from. Empty array if not trade-derived."),
  briefingIds: z.array(z.string()).describe("AnalystBriefing IDs this pattern came from. Empty array if not briefing-derived."),
  dataPoints: z
    .array(z.string())
    .describe(
      "2-5 short chips the UI shows, e.g. '$XYZ LOSS -$180', '$XYZ LOSS -$240', '$XYZ LOSS -$95'. Empty array if n/a.",
    ),
});

export type Evidence = z.infer<typeof evidenceSchema>;

// ── Proposed diff — discriminated union over kind ────────────────────────────

const promptEditDiff = z.object({
  kind: z.literal("PROMPT_EDIT"),
  // Full replacement text. Never a regex patch — the approve path writes
  // the string through updateAnalystField verbatim, so it must be the
  // post-edit value the analyst should carry forward.
  nextAnalystPrompt: z.string().min(20).max(8000),
  // Human-readable 1-2 line summary of what changed, shown in the diff
  // card without asking the user to re-read the full prompt.
  summary: z.string().min(8).max(400),
});

const universeSectorDiff = z.object({
  kind: z.enum(["UNIVERSE_ADD_SECTOR", "UNIVERSE_REMOVE_SECTOR"]),
  sector: z.enum(SECTORS),
});

const universeIndustryDiff = z.object({
  kind: z.enum(["UNIVERSE_ADD_INDUSTRY", "UNIVERSE_REMOVE_INDUSTRY"]),
  industry: z.enum(INDUSTRIES),
});

const universeThemeDiff = z.object({
  kind: z.enum(["UNIVERSE_ADD_THEME", "UNIVERSE_REMOVE_THEME"]),
  // Themes are free-form; normalizeTheme uppercases + snake_cases at write time.
  theme: z.string().min(2).max(80),
});

const watchlistDiff = z.object({
  kind: z.enum(["WATCHLIST_ADD", "WATCHLIST_REMOVE"]),
  ticker: z
    .string()
    .regex(/^[A-Z]{1,6}(\.[A-Z])?$/, "Tickers are 1-6 uppercase letters, optionally with a .X suffix")
    .describe("Uppercase ticker symbol."),
});

const exclusionAddDiff = z.object({
  kind: z.literal("EXCLUSION_ADD"),
  ticker: z.string().regex(/^[A-Z]{1,6}(\.[A-Z])?$/),
});

const intelligenceQueryAddDiff = z.object({
  kind: z.literal("INTELLIGENCE_QUERY_ADD"),
  query: z.string().min(10).max(200),
  // Category maps to Monitor.category. THEMATIC is the default; MARKET and
  // SECTOR are allowed so the pass can propose cross-sector macro queries,
  // but per-TICKER queries are forbidden (they duplicate portfolio-watchlist-monitor).
  category: z.enum(["THEMATIC", "SECTOR", "EVENT", "MARKET"]),
});

const intelligenceQueryRemoveDiff = z.object({
  kind: z.literal("INTELLIGENCE_QUERY_REMOVE"),
  // Monitor ID to remove. The pass only proposes removal of USER- or
  // BUILDER-origin monitors surfaced in the input bundle.
  monitorId: z.string().min(1),
  queryText: z.string().min(1).describe("The query text, shown in the diff card for context."),
});

const metaCommentaryDiff = z.object({
  kind: z.literal("META_COMMENTARY"),
  // No structural change — the user reads + acknowledges, nothing to apply.
  note: z.string().min(20).max(800),
});

export const proposedDiffSchema = z.discriminatedUnion("kind", [
  promptEditDiff,
  universeSectorDiff,
  universeIndustryDiff,
  universeThemeDiff,
  watchlistDiff,
  exclusionAddDiff,
  intelligenceQueryAddDiff,
  intelligenceQueryRemoveDiff,
  metaCommentaryDiff,
]);

export type ProposedDiff = z.infer<typeof proposedDiffSchema>;

// Narrow helper: diff.kind and the Suggestion.kind column are the same string.
export function kindFromDiff(diff: ProposedDiff): SuggestionKind {
  return diff.kind;
}

// ── Full suggestion schema (what GPT-4o returns) ─────────────────────────────
//
// OpenAI structured-outputs strict mode requires every property in `required`,
// so nothing is .optional(). Empty arrays / empty strings are the "n/a" signal
// — same convention as the briefing schema.

export const suggestionSchema = z.object({
  title: z
    .string()
    .min(6)
    .max(140)
    .describe(
      "One-line card title. E.g. 'Consider excluding $XYZ after 3 losses' or 'Add a query for Fed rate reaction'.",
    ),
  rationale: z
    .string()
    .min(40)
    .max(600)
    .describe(
      "2-3 sentence explanation. Must cite the specific pattern (tickers, P&L, dates) the pattern came from. No vague advice.",
    ),
  sourceRunId: z
    .string()
    .describe(
      "The single most relevant run this pattern points at, or empty string if not run-derived.",
    ),
  evidence: evidenceSchema,
  proposedDiff: proposedDiffSchema,
});

export type SuggestionProposal = z.infer<typeof suggestionSchema>;

// ── Batch schema — one GPT-4o call returns all suggestions for an analyst ────

export const suggestionBatchSchema = z.object({
  suggestions: z
    .array(suggestionSchema)
    .max(10)
    .describe("0-10 suggestions. Prefer high-signal over high-count. Empty array if nothing is worth proposing."),
});

export type SuggestionBatch = z.infer<typeof suggestionBatchSchema>;
