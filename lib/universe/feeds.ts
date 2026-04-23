/**
 * feeds.ts — canonical "firm-aggregate feed" vocabulary.
 *
 * Feeds are the firehose channels an analyst opts into via `AgentConfig.feeds`.
 * They are conceptually a peer of Universe sectors / industries / themes — same
 * routing-fence semantic, just a different dimension. Conceptually:
 *
 *   • A feed match means "this is the kind of firehose I hunt in" (e.g. an
 *     EARNINGS_CALENDAR analyst auto-receives the entire daily calendar).
 *   • Universe composition still applies. An analyst with `feeds: [EARNINGS_CALENDAR]`
 *     plus `industries: [Semiconductors]` ends up with the calendar fenced
 *     to semis names — same router, no special-case mode flag.
 *   • Analysts with no relevant feeds still receive aggregate signals via the
 *     ticker-intersection path when the aggregate names a watchlist or
 *     position ticker. That is a router-side concern, not a feed concern.
 *
 * Values mirror `Signal.aggregateType` 1:1 so the router does a direct
 * membership check (`analyst.feeds.includes(signal.aggregateType)`) — no
 * mapping table.
 *
 * To add a new feed:
 *   1. Add the canonical value here (uppercase, snake-case suffix matches
 *      existing convention)
 *   2. Have the producer write `aggregateType: "<NEW_VALUE>"` on the Signal
 *   3. Add the corresponding `defaultFeeds` entry to any matching
 *      strategy archetype in `lib/agent/knowledge/strategy-archetypes.ts`
 */

export const FEEDS = [
  "EARNINGS_CALENDAR",
  "MARKET_MOVERS_GAINERS",
  "MARKET_MOVERS_LOSERS",
  "MARKET_MOVERS_ACTIVES",
] as const;

export type Feed = (typeof FEEDS)[number];

const FEED_SET: ReadonlySet<string> = new Set(FEEDS);

/**
 * Map a raw feed string to its canonical form. Returns `null` for unknowns —
 * callers must drop or flag (do not coerce).
 */
export function normalizeFeed(raw: string | null | undefined): Feed | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Aliases tolerated in case a Builder LLM emits a near-miss; keep this list
  // tight — the canonical values are what the schema and producers use.
  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  if (FEED_SET.has(upper)) return upper as Feed;
  if (upper === "EARNINGS") return "EARNINGS_CALENDAR";
  if (upper === "GAINERS" || upper === "TOP_GAINERS") return "MARKET_MOVERS_GAINERS";
  if (upper === "LOSERS" || upper === "TOP_LOSERS") return "MARKET_MOVERS_LOSERS";
  if (upper === "ACTIVES" || upper === "MOST_ACTIVE" || upper === "MOST_ACTIVES") {
    return "MARKET_MOVERS_ACTIVES";
  }
  return null;
}

/** Normalize an array of raw feed strings, dropping unknowns + deduplicating. */
export function normalizeFeeds(
  raw: readonly (string | null | undefined)[],
): Feed[] {
  const seen = new Set<Feed>();
  const out: Feed[] = [];
  for (const item of raw) {
    const canon = normalizeFeed(item);
    if (canon && !seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
    }
  }
  return out;
}

/**
 * Human-readable label for a feed, used in UI chips and tool output.
 * Returns the raw string if not canonical so legacy values still display.
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
