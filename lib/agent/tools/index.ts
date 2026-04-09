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

// ── Migrated individual tools (via defineTool) ────────────────────────────────
export { getEarningsData } from "./get-earnings-data";

// Remaining tools are still in ../tools.ts and will move here in Step 4:
// export { getMarketContext } from "./get-market-context";
// ...
