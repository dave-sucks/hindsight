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
import { getOptionsFlow } from "./get-options-flow";
import { getSecFilings } from "./get-sec-filings";
import { readSignals } from "./read-signals";
import { readArtifact } from "./read-artifact";
import { webSearch } from "./web-search";
import { recordThesis } from "./record-thesis";
import { updateThesis } from "./update-thesis";
import { getTheses } from "./get-theses";
import { placeTrade } from "./place-trade";
import { closePosition } from "./close-position";
import { managePosition } from "./manage-position";
import { recordRunSummary } from "./record-run-summary";
import { completeRun } from "./complete-run";
import { manageWatchlist } from "./manage-watchlist";
import { getPortfolioContext } from "./get-portfolio-context";
import { readKnowledgeLibrary } from "./read-knowledge-library";
import { askQuestion } from "./ask-question";
import { discoverSignalsForFence } from "./discover-signals-for-fence";
import { readAnalystInboxStats } from "./read-analyst-inbox-stats";
import { writeSegmentTranscript } from "./write-segment-transcript";
import { readPastTranscripts } from "./read-past-transcripts";

interface ToolCtx {
  runId: string;
  userId: string;
  analystId?: string;
  /** Podcast feature — FK to PodcastSegment for segment runs. */
  podcastSegmentId?: string;
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
  maxPositionSize?: number;
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
   * Full set of tickers this analyst already covers (ACTIVE + WATCHING
   * theses + watchlist + open positions). Discovery scope ("universe")
   * excludes this set; "covered" lookups include only this set. Populated
   * by discovery-run.ts. See ToolContext.coveredTickers.
   */
  coveredTickers?: string[];
}

export function createResearchTools(ctx: ToolCtx) {
  // In-run tool-call tracker — shared across all tool instances in this
  // run. get_stock_data populates TICKER → {"get_stock_data", ...};
  // record_thesis gates against this to enforce "researched before thesis."
  // Lives for the duration of a single run (one createResearchTools call).
  const calledTickers = new Map<string, Set<string>>();
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
    get_options_flow: getOptionsFlow(newCtx),
    get_sec_filings: getSecFilings(newCtx),
    read_signals: readSignals(newCtx),
    read_artifact: readArtifact(newCtx),
    web_search: webSearch(newCtx),
    record_thesis: recordThesis(newCtx),
    update_thesis: updateThesis(newCtx),
    get_theses: getTheses(newCtx),
    place_trade: placeTrade(newCtx),
    close_position: closePosition(newCtx),
    manage_position: managePosition(newCtx),
    get_portfolio_context: getPortfolioContext(newCtx),
    record_run_summary: recordRunSummary(newCtx),
    complete_run: completeRun(newCtx),
    manage_watchlist: manageWatchlist(newCtx),
    read_knowledge_library: readKnowledgeLibrary(newCtx),
    ask_question: askQuestion(newCtx),
    discover_signals_for_fence: discoverSignalsForFence(newCtx),
    read_analyst_inbox_stats: readAnalystInboxStats(newCtx),
    // Podcast feature — see docs/PODCAST_PLAN.md.
    write_segment_transcript: writeSegmentTranscript(newCtx),
    read_past_transcripts: readPastTranscripts(newCtx),
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
export { getOptionsFlow } from "./get-options-flow";
export { getSecFilings } from "./get-sec-filings";
export { readSignals } from "./read-signals";
export { readArtifact } from "./read-artifact";
export { webSearch } from "./web-search";
export { recordThesis } from "./record-thesis";
export { updateThesis } from "./update-thesis";
export { getTheses } from "./get-theses";
export { placeTrade } from "./place-trade";
export { closePosition } from "./close-position";
export { managePosition } from "./manage-position";
export { getPortfolioContext } from "./get-portfolio-context";
export { recordRunSummary } from "./record-run-summary";
export { completeRun } from "./complete-run";
export { manageWatchlist } from "./manage-watchlist";
export { readKnowledgeLibrary } from "./read-knowledge-library";
export { askQuestion } from "./ask-question";
export { discoverSignalsForFence } from "./discover-signals-for-fence";
export { readAnalystInboxStats } from "./read-analyst-inbox-stats";
export { writeSegmentTranscript } from "./write-segment-transcript";
export { readPastTranscripts } from "./read-past-transcripts";
export { suggestPodcastConfigTool } from "./suggest-podcast-config";
export type { SuggestedPodcastConfig } from "./suggest-podcast-config";
