/**
 * Tool registry — single export point for all agent tools.
 *
 * During the migration (Steps 3-4), individual tool files are added here one
 * by one using the defineTool() pattern. Until a tool is migrated, we fall
 * back to createResearchTools() from the legacy tools.ts.
 *
 * Once all 16 tools are migrated, createResearchTools is deleted and this
 * file is the sole source of truth.
 *
 * Usage in the unified route:
 *   import { buildToolSet } from "@/lib/agent/tools";
 *   const tools = buildToolSet(ctx, modeConfig.toolAllowlist);
 */

export { createResearchTools } from "../tools";

// Individual migrated tools are exported here as they arrive:
// export { getEarningsData } from "./get-earnings-data";
// export { getMarketContext } from "./get-market-context";
// ...
