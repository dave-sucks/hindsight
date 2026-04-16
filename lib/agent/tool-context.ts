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
  alpacaCreds?: AlpacaCredentials;
  watchlist?: string[];
  exclusionList?: string[];
  sectors?: string[];
  // ── Universe (B1) ──────────────────────────────────────────────────────
  industries?: string[];
  themes?: string[];
  marketCapMin?: number | null;
  marketCapMax?: number | null;
  maxPositionSize?: number;
  maxOpenPositions?: number;
  intelligencePolicy?: IntelligencePolicy;

  /**
   * Returns a stable group key for the given phase string.
   * Consecutive tool calls returning the same groupId collapse into one UI group.
   * Tools in the "research" phase all return "research", so they group together.
   * A non-grouped tool (action tool) returns no groupId, breaking the chain.
   */
  groupId(phase: string): string;
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
