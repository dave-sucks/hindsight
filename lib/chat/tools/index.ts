/**
 * Chat tool barrel exports — DAV-129
 *
 * Aggregates all tool factories and provides a single
 * createAllTools(userId) helper for route handlers.
 */
import { createTradingTools } from "./trading-tools";
import { createResearchTools } from "./research-tools";
import { createPortfolioTools } from "./portfolio-tools";

export { createTradingTools } from "./trading-tools";
export { createResearchTools } from "./research-tools";
export { createPortfolioTools } from "./portfolio-tools";

/**
 * Creates all chat tools for a given user.
 * Merges trading, research, and portfolio tools into a single object
 * ready to pass to streamText({ tools: ... }).
 */
export function createAllTools(userId: string) {
  return {
    ...createTradingTools(userId),
    ...createResearchTools(userId),
    ...createPortfolioTools(userId),
  };
}
