/**
 * feeds.ts — display labels for the firm-aggregate signal types
 * (`Signal.aggregateType`: earnings calendar, market movers) on the kept
 * signal history. The calendar and movers are read on demand
 * (get_earnings_calendar, get_market_movers).
 */

/**
 * Human-readable label for an aggregate type. Returns the raw string when
 * it isn't one of these, so legacy values still display.
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
