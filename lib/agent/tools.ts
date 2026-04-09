/**
 * Research agent tools — createResearchTools() factory.
 *
 * All 16 tools have been migrated to individual defineTool() files in
 * lib/agent/tools/. This file is now a thin delegation layer that
 * assembles the tool set from the individual factories.
 *
 * TODO: Once all callers migrate to use individual tool factories directly
 * (or the unified app/api/agent/[mode]/route.ts), delete this file and
 * update lib/agent/tools/index.ts to remove the re-export.
 */

import type { AlpacaCredentials } from "@/lib/alpaca";
import type { IntelligencePolicy } from "@/lib/intelligence/types";

import { getMarketContext } from "@/lib/agent/tools/get-market-context";
import { getStockData } from "@/lib/agent/tools/get-stock-data";
import { getEarningsData } from "@/lib/agent/tools/get-earnings-data";
import { getOptionsFlow } from "@/lib/agent/tools/get-options-flow";
import { getSecFilings } from "@/lib/agent/tools/get-sec-filings";
import { readMorningBrief } from "@/lib/agent/tools/read-morning-brief";
import { readSignals } from "@/lib/agent/tools/read-signals";
import { readArtifact } from "@/lib/agent/tools/read-artifact";
import { webSearch } from "@/lib/agent/tools/web-search";
import { recordThesis } from "@/lib/agent/tools/record-thesis";
import { placeTrade } from "@/lib/agent/tools/place-trade";
import { closePosition } from "@/lib/agent/tools/close-position";
import { recordDecisionPlan } from "@/lib/agent/tools/record-decision-plan";
import { recordRunSummary } from "@/lib/agent/tools/record-run-summary";
import { completeRun } from "@/lib/agent/tools/complete-run";
import { manageWatchlist } from "@/lib/agent/tools/manage-watchlist";

interface ToolContext {
  runId: string;
  userId: string;
  analystId?: string;
  watchlist?: string[];
  exclusionList?: string[];
  sectors?: string[];
  maxPositionSize?: number;
  maxOpenPositions?: number;
  alpacaCreds?: AlpacaCredentials;
  intelligencePolicy?: IntelligencePolicy;
}

export function createResearchTools(ctx: ToolContext) {
  // Build a ToolContext compatible with the exported ToolContext from tool-context.ts.
  // The private interface here lacks groupId(), so we cast to any for the adapter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newCtx: any = { ...ctx, groupId: (phase: string) => phase };

  const toolsBase = {
    get_market_context: getMarketContext(newCtx),
    get_stock_data: getStockData(newCtx),
    get_earnings_data: getEarningsData(newCtx),
    get_options_flow: getOptionsFlow(newCtx),
    get_sec_filings: getSecFilings(newCtx),
    read_morning_brief: readMorningBrief(newCtx),
    read_signals: readSignals(newCtx),
    read_artifact: readArtifact(newCtx),
    web_search: webSearch(newCtx),
    record_thesis: recordThesis(newCtx),
    place_trade: placeTrade(newCtx),
    close_position: closePosition(newCtx),
    record_decision_plan: recordDecisionPlan(newCtx),
    record_run_summary: recordRunSummary(newCtx),
    complete_run: completeRun(newCtx),
    manage_watchlist: manageWatchlist(newCtx),
  };

  // Backward-compat aliases for old persisted RunMessages that reference old tool names
  const tools = toolsBase as Record<string, unknown>;
  tools.show_thesis = toolsBase.record_thesis;
  tools.summarize_run = toolsBase.complete_run;

  return toolsBase as typeof toolsBase & {
    show_thesis: typeof toolsBase.record_thesis;
    summarize_run: typeof toolsBase.complete_run;
  };
}
