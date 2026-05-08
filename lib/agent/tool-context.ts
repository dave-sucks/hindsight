/**
 * ToolContext — per-request context threaded through every tool execution.
 *
 * Replaces the inline `ToolContext` interface that was private to tools.ts.
 * Now exported so defineTool() and the unified route can share the type.
 */

import type { AlpacaCredentials } from "@/lib/alpaca";
import type { IntelligencePolicy } from "@/lib/intelligence/types";

export interface ToolContext {
  runId: string;
  userId: string;
  /** FK to AgentConfig — required for Position, TradeDecision, Thesis creation */
  analystId?: string;
  /**
   * FK to PodcastSegment — set when the run is a podcast-segment-run.
   * Mutually exclusive with analystId in practice; the route picks one
   * based on which FK is populated on the ResearchRun row.
   * write_segment_transcript and the podcast branch of complete_run
   * read this. See docs/PODCAST_PLAN.md.
   */
  podcastSegmentId?: string;
  alpacaCreds?: AlpacaCredentials;
  watchlist?: string[];
  /**
   * Tickers currently held by this analyst (status=OPEN). Propagated so tools
   * like get_stock_data can short-circuit the fence check — held positions
   * should always be in-scope for analysis, no matter what the sector fence
   * says about them.
   */
  positionTickers?: string[];
  exclusionList?: string[];
  sectors?: string[];
  // ── Universe (B1) ──────────────────────────────────────────────────────
  industries?: string[];
  themes?: string[];
  marketCapMin?: number | null;
  marketCapMax?: number | null;
  maxPositionSize?: number;
  maxOpenPositions?: number;
  /**
   * Minimum thesis confidence (0-100) required for place_trade to proceed.
   * Enforced inside place_trade, not just advised to the model. Defaults
   * to 60 when undefined.
   */
  minConfidence?: number;
  intelligencePolicy?: IntelligencePolicy;

  /**
   * When true, read_signals returns ONLY the discoverySignals bucket and
   * zeroes out portfolioSignals + watchlistSignals. Used by the weekly
   * discovery cron to keep the agent focused on net-new candidates only —
   * the prompt was asking the LLM to mentally filter, but the chat
   * rendering of "all three buckets in one flat list" looked like noise
   * about already-covered names and the agent still acted on the wrong
   * signals. Set in lib/inngest/functions/discovery-run.ts.
   */
  discoveryOnly?: boolean;

  /**
   * Returns a stable group key for the given phase string.
   * Consecutive tool calls returning the same groupId collapse into one UI group.
   * Tools in the "research" phase all return "research", so they group together.
   * A non-grouped tool (action tool) returns no groupId, breaking the chain.
   */
  groupId(phase: string): string;

  /**
   * In-run tool-call tracker. Maps TICKER (uppercase) → set of tool names
   * that were called for that ticker in this run. Enables programmatic
   * gates like "record_thesis may only be called for tickers that were
   * researched via get_stock_data earlier in this run." Without this,
   * the agent can narrate a thesis with no underlying research and
   * record_thesis accepts it silently.
   *
   * Tools populate this themselves (see get_stock_data). Shared reference
   * across all tool instances in the same run — created once per run in
   * createResearchTools().
   */
  calledTickers?: Map<string, Set<string>>;

  /**
   * In-run signal tracker. Maps TICKER (uppercase) → set of signalIds that
   * were returned by read_signals for that ticker in this run. Drives the
   * provenance soft-nudge in record_thesis: when the agent picks
   * source_kind=WEB_SEARCH for a ticker that had matching routed signals,
   * we know read_signals informed the thesis and the trade-evaluator's
   * monitor-credit chain just lost its hook. Skipping the citation kills
   * the Pillar 5 self-improvement loop. Populated by read_signals.
   */
  signalsByTicker?: Map<string, Set<string>>;
}

/** Create a ToolContext from plain options (adds the groupId method). */
export function createToolContext(
  opts: Omit<ToolContext, "groupId">,
): ToolContext {
  return {
    ...opts,
    groupId(phase: string): string {
      return phase;
    },
  };
}
