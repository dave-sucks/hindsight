/**
 * A paused analyst runs nothing, but a stock it still holds keeps its sale triggers: the five-minute check
 * reads only those for it, and the trigger run sends each fire to the owner as a sale, never to the agent. Pure.
 */

/** The triggers the five-minute check reads on a paused analyst's stock: a held stock's sales, nothing else. */
export function pausedAnalystTriggers<T extends { action: string }>(ladder: T[], status: string): T[] {
  return status === "HOLDING" ? ladder.filter((t) => t.action === "EXIT") : [];
}

/** The line a paused analyst's sale carries to the owner. */
export const PAUSED_SALE_NOTE = "Its analyst is paused, so this sale came to you instead of the analyst.";
