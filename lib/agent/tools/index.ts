/**
 * Tool registry — single export point for all agent tools.
 *
 * All tools live in individual defineTool() files in this directory.
 * createResearchTools() assembles them for the unified route and crons.
 *
 * Pull tools for firm aggregates (get_earnings_calendar, get_market_movers)
 * complement the subscription path (`AgentConfig.feeds`): subscribed analysts
 * get the firehose routed automatically; any analyst can pull on-demand.
 */

import type { AlpacaCredentials } from "@/lib/alpaca";
import type { IntelligencePolicy } from "@/lib/intelligence/types";

import { getMarketContext } from "./get-market-context";
import { getStockData } from "./get-stock-data";
import { getEarningsData } from "./get-earnings-data";
import { getEarningsCalendar } from "./get-earnings-calendar";
import { getMarketMovers } from "./get-market-movers";
import { getSecFilings } from "./get-sec-filings";
// THESIS_RESEARCH_V2 — Phase 1 deep-research data tools.
// See docs/plans/THESIS_RESEARCH_V2.md §3.
import { getFinancialsDeep } from "./get-financials-deep";
import { getAnalystCoverage } from "./get-analyst-coverage";
import { getInsiderActivity } from "./get-insider-activity";
import { getEarningsHistory } from "./get-earnings-history";
import { getPeersWithMetrics } from "./get-peers-with-metrics";
// THESIS_RESEARCH_V2 — Phase 1 meta-tool + orchestrator dispatch.
import { writeThesisResearch } from "./write-thesis-research";
import { dispatchThesisResearch } from "./dispatch-thesis-research";
// THESIS_LIFECYCLE_FIX Phase 2 — polling wait for a dispatched refresh
// to land before the parent agent proceeds.
import { waitForThesisRefresh } from "./wait-for-thesis-refresh";
import { readSignals } from "./read-signals";
import { readArtifact } from "./read-artifact";
import { webSearch } from "./web-search";
import { twitterSearch } from "./twitter-search";
import { recordThesis } from "./record-thesis";
import { updateThesis } from "./update-thesis";
import { getTheses } from "./get-theses";
import { placeTrade } from "./place-trade";
import { closePosition } from "./close-position";
import { managePosition } from "./manage-position";
import { recordRunSummary } from "./record-run-summary";
import { completeRun } from "./complete-run";
import { getPortfolioContext } from "./get-portfolio-context";
import { readKnowledgeLibrary } from "./read-knowledge-library";
import { askQuestion } from "./ask-question";
import { discoverSignalsForFence } from "./discover-signals-for-fence";
import { readAnalystInboxStats } from "./read-analyst-inbox-stats";
import { writeSegmentTranscript } from "./write-segment-transcript";
import { readPastTranscripts } from "./read-past-transcripts";
// Principal-chat cross-cutting read tools
import { listAnalysts } from "./list-analysts";
import { readAnalystConfig } from "./read-analyst-config";
import { listRuns } from "./list-runs";
import { readRun } from "./read-run";
import { listMonitors } from "./list-monitors";
import { readAccuracyReports } from "./read-accuracy-reports";
import { listPositionsAll } from "./list-positions-all";
import { listThesesAll } from "./list-theses-all";
import { listProposals } from "./list-proposals";
import { readDatabase } from "./read-database";

interface ToolCtx {
  runId: string;
  userId: string;
  accountId: string;
  analystId?: string;
  /** Podcast feature — FK to PodcastSegment for segment runs. */
  podcastSegmentId?: string;
  /** ResearchRun.mode — needed for mode-specific tool gates. See ToolContext.runMode. */
  runMode?: string;
  watchlist?: string[];
  /** Open-position tickers (status=OPEN) for the analyst — fence bypass. */
  positionTickers?: string[];
  exclusionList?: string[];
  sectors?: string[];
  // ── Universe (B1) ──────────────────────────────────────────────────
  industries?: string[];
  themes?: string[];
  marketCapMin?: number | null;
  marketCapMax?: number | null;
  /** Per-entry floor — see ToolContext.minPositionSize. 0/undefined = off. */
  minPositionSize?: number;
  maxPositionSize?: number;
  /** Live promotion cap, LIVE only — see ToolContext.realMaxPosition. */
  realMaxPosition?: number;
  maxOpenPositions?: number;
  /** Min thesis confidence (0-100) required for place_trade — enforced. */
  minConfidence?: number;
  alpacaCreds?: AlpacaCredentials;
  /** Snapshot of ResearchRun.environment — see ToolContext.runEnvironment. */
  runEnvironment?: "PAPER" | "LIVE";
  intelligencePolicy?: IntelligencePolicy;
  /** Restrict read_signals to discoverySignals bucket only (discovery cron). */
  discoveryOnly?: boolean;
  /** Hide discoverySignals from read_signals (daily-run V2 cron). */
  dailyRunOnly?: boolean;
  /**
   * Chat-dispatched thesis-writer marker. P1-24: a record_thesis mint is
   * always WATCHING regardless (HOLDING is execution-owned, set by
   * place_trade). Set by dispatch_thesis_research for the Principal Chat
   * flow; refresh dispatches and tactical inline calls leave it unset.
   */
  forceWatchingMint?: boolean;
  /**
   * Full set of tickers this analyst already covers (ACTIVE + WATCHING
   * theses + watchlist + open positions). Discovery scope ("universe")
   * excludes this set; "covered" lookups include only this set. Populated
   * by discovery-run.ts. See ToolContext.coveredTickers.
   */
  coveredTickers?: string[];
  /**
   * Deterministic STOP/TARGET close tag for a protective/price EXIT tactical
   * run — see ToolContext.protectiveExitReason. Set by tactical-run.ts when
   * the fired trigger is a price-level protective exit; close_position uses
   * it in place of the model-chosen reason so the close inherits the P1-28
   * cooldown exemption.
   */
  protectiveExitReason?: "STOP" | "TARGET";
  /**
   * Human phrase for that protective trigger — see
   * ToolContext.protectiveExitTriggerLabel. Named in the sale-label
   * auto-correction audit note.
   */
  protectiveExitTriggerLabel?: string;
}

export function createResearchTools(
  ctx: ToolCtx,
  opts?: {
    /**
     * Tickers already researched EARLIER IN THIS CONVERSATION, recovered
     * from the run's persisted messages.
     *
     * The tracker below is rebuilt on every createResearchTools call, i.e.
     * once per HTTP request. A cron run is one request, so the gate worked.
     * A chat is one request PER TURN — so on 2026-08-25 a Catalyst session
     * that had already researched 13 tickers in turn 1 came back in turn 2
     * with an empty map, had every record_thesis rejected as "not
     * researched", re-ran all 13 get_stock_data calls, retried, and wrote
     * the whole batch a second time. Seeding closes that hole by supplying
     * the missing input rather than by loosening the gate.
     */
    researchedTickers?: string[];
  },
) {
  // In-run tool-call tracker — shared across all tool instances in this
  // run. get_stock_data populates TICKER → {"get_stock_data", ...};
  // record_thesis gates against this to enforce "researched before thesis."
  // Seeded from prior turns of the same run when the caller supplies them.
  const calledTickers = new Map<string, Set<string>>();
  for (const t of opts?.researchedTickers ?? []) {
    const key = t.toUpperCase();
    const existing = calledTickers.get(key) ?? new Set<string>();
    existing.add("get_stock_data");
    calledTickers.set(key, existing);
  }
  // In-run signal tracker — read_signals populates TICKER → {signalId, ...}
  // for every ticker on every routed signal it returned. record_thesis reads
  // it to soft-nudge the agent toward ROUTED_SIGNAL provenance when the
  // chain is available — the Monitor ROI tracer needs sourceSignalIds to
  // credit the producing monitor (VISION Pillar 5).
  const signalsByTicker = new Map<string, Set<string>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newCtx: any = {
    ...ctx,
    groupId: (phase: string) => phase,
    calledTickers,
    signalsByTicker,
  };

  const toolsBase = {
    get_market_context: getMarketContext(newCtx),
    get_stock_data: getStockData(newCtx),
    get_earnings_data: getEarningsData(newCtx),
    get_earnings_calendar: getEarningsCalendar(newCtx),
    get_market_movers: getMarketMovers(newCtx),
    get_sec_filings: getSecFilings(newCtx),
    // THESIS_RESEARCH_V2 — Phase 1 deep-research data tools.
    get_financials_deep: getFinancialsDeep(newCtx),
    get_analyst_coverage: getAnalystCoverage(newCtx),
    get_insider_activity: getInsiderActivity(newCtx),
    get_earnings_history: getEarningsHistory(newCtx),
    get_peers_with_metrics: getPeersWithMetrics(newCtx),
    // THESIS_RESEARCH_V2 — Phase 1.
    // write_thesis_research is the meta-tool the thesis-writer agent calls.
    // dispatch_thesis_research is the orchestrator-side spawner used by
    // Principal Chat (and later Discovery / Daily / Tactical).
    write_thesis_research: writeThesisResearch(newCtx),
    dispatch_thesis_research: dispatchThesisResearch(newCtx),
    wait_for_thesis_refresh: waitForThesisRefresh(newCtx),
    read_signals: readSignals(newCtx),
    read_artifact: readArtifact(newCtx),
    web_search: webSearch(newCtx),
    twitter_search: twitterSearch(newCtx),
    record_thesis: recordThesis(newCtx),
    update_thesis: updateThesis(newCtx),
    get_theses: getTheses(newCtx),
    place_trade: placeTrade(newCtx),
    close_position: closePosition(newCtx),
    manage_position: managePosition(newCtx),
    get_portfolio_context: getPortfolioContext(newCtx),
    record_run_summary: recordRunSummary(newCtx),
    complete_run: completeRun(newCtx),
    read_knowledge_library: readKnowledgeLibrary(newCtx),
    ask_question: askQuestion(newCtx),
    discover_signals_for_fence: discoverSignalsForFence(newCtx),
    read_analyst_inbox_stats: readAnalystInboxStats(newCtx),
    // Podcast feature — see docs/PODCAST_PLAN.md.
    write_segment_transcript: writeSegmentTranscript(newCtx),
    read_past_transcripts: readPastTranscripts(newCtx),
    // Principal-chat cross-cutting read tools — only included in
    // principal-mode toolAllowlist; safe to register here unconditionally
    // because the per-mode allowlist filters them out everywhere else.
    list_analysts: listAnalysts(newCtx),
    read_analyst_config: readAnalystConfig(newCtx),
    list_runs: listRuns(newCtx),
    read_run: readRun(newCtx),
    list_monitors: listMonitors(newCtx),
    read_accuracy_reports: readAccuracyReports(newCtx),
    list_positions_all: listPositionsAll(newCtx),
    list_theses_all: listThesesAll(newCtx),
    list_proposals: listProposals(newCtx),
    read_database: readDatabase(newCtx),
  };

  // Backward-compat aliases for old persisted RunMessages
  const tools = toolsBase as Record<string, unknown>;
  tools.show_thesis = toolsBase.record_thesis;
  tools.summarize_run = toolsBase.complete_run;

  return toolsBase as typeof toolsBase & {
    show_thesis: typeof toolsBase.record_thesis;
    summarize_run: typeof toolsBase.complete_run;
  };
}

// ── Individual tool exports ────────────────────────────────────────────────────
export { getMarketContext } from "./get-market-context";
export { getStockData } from "./get-stock-data";
export { getEarningsData } from "./get-earnings-data";
export { getEarningsCalendar } from "./get-earnings-calendar";
export { getMarketMovers } from "./get-market-movers";
export { getSecFilings } from "./get-sec-filings";
// THESIS_RESEARCH_V2 — Phase 1 deep-research data tools.
export { getFinancialsDeep } from "./get-financials-deep";
export { getAnalystCoverage } from "./get-analyst-coverage";
export { getInsiderActivity } from "./get-insider-activity";
export { getEarningsHistory } from "./get-earnings-history";
export { getPeersWithMetrics } from "./get-peers-with-metrics";
// THESIS_RESEARCH_V2 — Phase 1.
export { writeThesisResearch } from "./write-thesis-research";
export { dispatchThesisResearch } from "./dispatch-thesis-research";
// THESIS_LIFECYCLE_FIX Phase 2.
export { waitForThesisRefresh } from "./wait-for-thesis-refresh";
export { readSignals } from "./read-signals";
export { readArtifact } from "./read-artifact";
export { webSearch } from "./web-search";
export { twitterSearch } from "./twitter-search";
export { recordThesis } from "./record-thesis";
export { updateThesis } from "./update-thesis";
export { getTheses } from "./get-theses";
export { placeTrade } from "./place-trade";
export { closePosition } from "./close-position";
export { managePosition } from "./manage-position";
export { getPortfolioContext } from "./get-portfolio-context";
export { recordRunSummary } from "./record-run-summary";
export { completeRun } from "./complete-run";
export { readKnowledgeLibrary } from "./read-knowledge-library";
export { askQuestion } from "./ask-question";
export { discoverSignalsForFence } from "./discover-signals-for-fence";
export { readAnalystInboxStats } from "./read-analyst-inbox-stats";
export { writeSegmentTranscript } from "./write-segment-transcript";
export { readPastTranscripts } from "./read-past-transcripts";
export { suggestPodcastConfigTool } from "./suggest-podcast-config";
export type { SuggestedPodcastConfig } from "./suggest-podcast-config";
// Principal-chat tools
export { listAnalysts } from "./list-analysts";
export { readAnalystConfig } from "./read-analyst-config";
export { listRuns } from "./list-runs";
export { readRun } from "./read-run";
export { listMonitors } from "./list-monitors";
export { readAccuracyReports } from "./read-accuracy-reports";
export { listPositionsAll } from "./list-positions-all";
export { listThesesAll } from "./list-theses-all";
export { listProposals } from "./list-proposals";
export { readDatabase } from "./read-database";
