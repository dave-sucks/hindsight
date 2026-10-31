/**
 * ToolContext — per-request context threaded through every tool execution.
 *
 * Replaces the inline `ToolContext` interface that was private to tools.ts.
 * Now exported so defineTool() and the unified route can share the type.
 */

import type { AlpacaCredentials } from "@/lib/alpaca";

export interface ToolContext {
  runId: string;
  userId: string;
  /**
   * FK to Account — the multi-tenant scope. Every row a tool inserts must
   * be tagged with this. See docs/TEAM_ACCESS_PLAN.md.
   */
  accountId: string;
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
  /**
   * ResearchRun.mode for this execution — needed for mode-specific gates
   * that can't reasonably do their own DB lookup. The complete_run
   * preflight (lib/agent/tools/complete-run.ts) uses it to skip the
   * `no_run_summary` check for INTRADAY_TACTICAL runs, which don't have
   * record_run_summary in their tool allowlist.
   *
   * Optional for backward compat — callers without it just get the
   * full default behavior. New call sites should pass it through from
   * ResearchRun.mode.
   */
  runMode?: string;
  alpacaCreds?: AlpacaCredentials;
  /**
   * Snapshot of the run's environment (ResearchRun.environment). Pinned
   * for the duration of the run so a mid-run promotion can't split tool
   * calls across two Alpaca accounts. Drives:
   *  - place_trade: tag new Position/Order rows with this env
   *  - get_portfolio_context: filter positions to this env
   *  - close_position / manage_position: refuse to operate on a position
   *    whose env differs from the run's env (defensive)
   * Defaults to PAPER when unset (older runs / builder / editor modes).
   */
  runEnvironment?: "PAPER" | "LIVE";
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
  marketCapMin?: number | null;
  marketCapMax?: number | null;
  /**
   * Floor of the per-entry position band. Wired from
   * AgentConfig.minPositionSize; 0/undefined = no floor. place_trade rejects
   * an entry below it (Guardrail 5b) rather than resizing the order — the
   * agent either commits real size or skips the name. Does NOT apply to
   * add_to_position scale-ins. See lib/agent/position-sizing.ts.
   */
  minPositionSize?: number;
  maxPositionSize?: number;
  /**
   * The most this analyst may hold in one stock (AgentConfig.maxPositionTotal)
   * — the ceiling for adding to a winner. 0/undefined = twice the largest
   * trade. See lib/agent/position-sizing.ts.
   */
  maxPositionTotal?: number;
  maxOpenPositions?: number;
  /**
   * Minimum thesis confidence (0-100) required for place_trade to proceed.
   * Enforced inside place_trade, not just advised to the model. Defaults
   * to 60 when undefined.
   */
  minConfidence?: number;

  /**
   * Chat-dispatched thesis-writer mints clamp to WATCHING. P1-24: a
   * record_thesis mint is always WATCHING regardless of this flag (a mint
   * never has a position; HOLDING is execution-owned). This flag survives as
   * the chat-dispatch marker that also suppresses the would-be ACTIVE-request
   * warning. Set by dispatch_thesis_research for the Principal Chat flow so
   * exploratory chat dispatches don't produce trade-eligible coverage that
   * would later fire orphan tactical EXIT runs. Phase-3 daily-run refresh
   * dispatches and Phase-4 tactical inline calls leave this unset.
   */
  forceWatchingMint?: boolean;

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
   * Deterministic close reason for a protective/price EXIT tactical run. Set
   * by lib/inngest/functions/tactical-run.ts when THIS run was woken by a
   * price-level protective EXIT trigger (trail, move-from-entry, price
   * levels, move-from-a-close). When present, close_position tags the close
   * with this STOP/TARGET reason INSTEAD of the model-chosen `reason` arg:
   * a declined STOP is a declined sale the next run must answer (lib/agent/declined-sale.ts), and a TARGET sale sends the stock back to watching (lib/proposals/thesis-flips.ts).
   * Undefined for daily runs and for tactical runs woken by judgment EXIT
   * triggers (earnings, filings), which keep the LLM's own tag. See
   * lib/agent/triggers/types.ts → protectiveExitCloseReason.
   */
  protectiveExitReason?: "STOP" | "TARGET";

  /**
   * Human phrase for the protective trigger that woke this run, e.g.
   * "Trailing 8% from high" (predicateSentence of the fired predicate).
   * Set alongside protectiveExitReason by tactical-run.ts. Named in the
   * auto-correction note the close tools write into the audit trail, so a
   * corrected sale label explains itself without a code read (DAV-192).
   */
  protectiveExitTriggerLabel?: string;

  /** A trigger run woken by a trim: its stock and size, the trim a partial_close naming no size sells. */
  firedTrim?: { ticker: string; pct: number };

  /** Set only for an Auto trigger: the account's cash. A buy or add costing more is refused, as on the Trade button (null = unreadable). */
  payFromCash?: number | null;

  /**
   * Check only: record_thesis / update_thesis run every check they run on a
   * real save — the input schema, the trigger ops, the plan check, the
   * status and belief rules — and return just before the first write, with
   * `data.dry_run: true` when the save would land. The thesis writer calls
   * this from its submit step so its own check IS the save's check: a field
   * or rule added to the save can't be missing from the writer (PRAX 09-11,
   * FIVE and DOCU 09-15 — the writer's form accepted what the save refused).
   * Refusals in a check-only call are not logged as gate rejections.
   */
  dryRun?: boolean;
}

/** The analyst's fence and limits, as the tools read them off ToolContext. */
export type AnalystToolSettings = Pick<
  ToolContext,
  "watchlist" | "exclusionList" | "sectors" | "marketCapMin" | "marketCapMax" | "minConfidence" | "minPositionSize" | "maxPositionSize" | "maxPositionTotal" | "maxOpenPositions"
>;

/**
 * An analyst's row as the tools read it, written once for every door that
 * loads the row (the Run button and the chat). Two hand copies drifted: the
 * chat's lost the smallest trade and the most in one stock, so a scoped
 * chat's buy had no floor and its add took twice the largest trade as the cap.
 */
export function analystToolSettings(
  row: {
    exclusionList: string[]; sectors: string[];
    marketCapMin: bigint | number | null; marketCapMax: bigint | number | null;
    minConfidence: number; maxOpenPositions: number;
    minPositionSize: unknown; maxPositionSize: unknown; maxPositionTotal: unknown;
  },
  watchlist: string[],
): AnalystToolSettings {
  const money = (v: unknown) => (v ? Number(v) : undefined);
  return {
    watchlist,
    exclusionList: row.exclusionList,
    sectors: row.sectors,
    marketCapMin: row.marketCapMin != null ? Number(row.marketCapMin) : null,
    marketCapMax: row.marketCapMax != null ? Number(row.marketCapMax) : null,
    minConfidence: row.minConfidence,
    minPositionSize: money(row.minPositionSize),
    maxPositionSize: money(row.maxPositionSize),
    maxPositionTotal: money(row.maxPositionTotal),
    maxOpenPositions: row.maxOpenPositions,
  };
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
