/**
 * stock-context-for.ts — the "what's been said" block for one stock, built
 * from its feed (lib/thesis/activity-feed.ts): the stock's saved Activity
 * lines plus its proposals' steps from their orders. get_theses and the
 * trigger run both read a stock through this, so every run reads the same
 * block the Overview shows.
 */
import { activityFeed, type ProposalOrder, type StoredLine } from "@/lib/thesis/activity-feed";
import { buildStockContext, type StockContext } from "@/lib/agent/stock-context";

/**
 * How many of a stock's newest Activity lines are loaded (about a month).
 * The agent reads the newest 8 of the feed; the situations read all of these
 * for an unanswered fire or an unanswered word of the principal's.
 */
export const ACTIVITY_LINES = 40;

/** The Activity columns every loader selects. */
export const ACTIVITY_SELECT = {
  id: true, thesisId: true, type: true, triggerId: true, timestamp: true, fieldChanges: true,
  summary: true, rationale: true, runId: true, priceAtTime: true, positionAtTime: true, signalIds: true, tradeId: true, run: { select: { mode: true } },
} as const;

export function stockContextFor(args: { ticker: string; rows: StoredLine[]; orders?: ProposalOrder[] }): StockContext {
  return buildStockContext({ ticker: args.ticker, feed: activityFeed({ updates: args.rows, orders: args.orders ?? [] }) });
}
