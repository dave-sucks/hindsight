/**
 * Tool registry — single export point for all agent tools.
 *
 * All 16 tools have been migrated to individual defineTool() files.
 * createResearchTools() in ../tools.ts now delegates every tool here.
 * Once tools.ts is deleted, this file is the sole source of truth.
 *
 * Usage in the unified route:
 *   import { buildToolSet } from "@/lib/agent/tools";
 *   const tools = buildToolSet(ctx, modeConfig.toolAllowlist);
 */

export { createResearchTools } from "../tools";

// ── Research tools ─────────────────────────────────────────────────────────────
export { getMarketContext } from "./get-market-context";
export { getStockData } from "./get-stock-data";
export { getEarningsData } from "./get-earnings-data";
export { getOptionsFlow } from "./get-options-flow";
export { getSecFilings } from "./get-sec-filings";

// ── Intelligence tools ─────────────────────────────────────────────────────────
export { readMorningBrief } from "./read-morning-brief";
export { readSignals } from "./read-signals";
export { readArtifact } from "./read-artifact";
export { webSearch } from "./web-search";

// ── Action tools ───────────────────────────────────────────────────────────────
export { recordThesis } from "./record-thesis";
export { placeTrade } from "./place-trade";
export { closePosition } from "./close-position";
export { recordDecisionPlan } from "./record-decision-plan";
export { recordRunSummary } from "./record-run-summary";
export { completeRun } from "./complete-run";
export { manageWatchlist } from "./manage-watchlist";
