/**
 * feeds.ts — the firm-aggregate signal types and their display labels.
 *
 * These mirror `Signal.aggregateType` (earnings calendar, market movers) as
 * the producers write it. They are display vocabulary only: the analyst
 * subscription dimension (`AgentConfig.feeds`) that once routed a whole
 * firehose was deleted 2026-09-11 — signal routing has been paused since
 * 2026-05-31 and the calendar and movers are read on demand
 * (get_earnings_calendar, get_market_movers).
 */

export const FEEDS = [
  "EARNINGS_CALENDAR",
  "MARKET_MOVERS_GAINERS",
  "MARKET_MOVERS_LOSERS",
  "MARKET_MOVERS_ACTIVES",
] as const;

export type Feed = (typeof FEEDS)[number];

/**
 * Human-readable label for an aggregate type. Returns the raw string when
 * it isn't one of the above so legacy values still display.
 */
export function feedLabel(feed: string): string {
  switch (feed) {
    case "EARNINGS_CALENDAR":
      return "Earnings Calendar";
    case "MARKET_MOVERS_GAINERS":
      return "Movers — Gainers";
    case "MARKET_MOVERS_LOSERS":
      return "Movers — Losers";
    case "MARKET_MOVERS_ACTIVES":
      return "Movers — Most Active";
    default:
      return feed;
  }
}
