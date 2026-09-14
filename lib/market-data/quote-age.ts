/**
 * How old is this price — decided in one place for buys, chat and research.
 *
 * Every Finnhub quote carries `t`, the time of its last print. Two things go
 * wrong without reading it:
 *   - at 09:30 the quote still reports Friday's close as "now" (ETN,
 *     2026-09-14: a buy fired on a price the stock never traded that day);
 *   - when the quote fails (the shared key's per-minute limit), research
 *     silently measured the chart from the last close and said nothing (NVDA,
 *     2026-09-14: read as above its 50-day while it was trading below it).
 *
 * So a price an agent receives says how old it is, and says so in words when
 * it isn't live. Pure.
 */

import { isMarketOpen } from "@/lib/market-hours";

/** Older than this during market hours, a quote is not today's price. */
export const STALE_QUOTE_MS = 15 * 60 * 1000;

type Quote = { c?: unknown; t?: unknown } | null | undefined;

/** Age of a quote in ms from its `t` (unix seconds); null when it carries none. */
export function quoteAgeMs(quote: Quote, now = Date.now()): number | null {
  const t = quote?.t;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
  return now - t * 1000;
}

/** The quote's price if it printed within STALE_QUOTE_MS; otherwise null. */
export function freshQuotePrice(quote: Quote, now: Date): number | null {
  const c = quote?.c;
  const age = quoteAgeMs(quote, now.getTime());
  return typeof c === "number" && c > 0 && age != null && age <= STALE_QUOTE_MS ? c : null;
}

/** A buy may not act on this quote: the market is open and the quote isn't from the last 15 minutes. */
export function staleForTrading(quote: Quote, now: Date): boolean {
  return isMarketOpen(now) && freshQuotePrice(quote, now) == null;
}

export interface PriceReading {
  price: number | null;
  /** When the price printed (ISO), or the close date for a last-close fallback. */
  asOf: string | null;
  ageMinutes: number | null;
  /** True only for a quote from the last 15 minutes while the market is open. */
  live: boolean;
  /** Plain words when the price is not what it looks like; null when it is. */
  warning: string | null;
  /** The same warning, short enough for a tool row. */
  warningShort: string | null;
}

const etStamp = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit" });
const closeStamp = (ymd: string) =>
  new Date(`${ymd}T16:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "2-digit", day: "2-digit" });
const reasonOf = (error: string | undefined) =>
  error && /429|rate.?limit/i.test(error) ? "the quote was rate-limited" : "the quote failed";

export function readPrice(opts: {
  ticker: string;
  quote: Quote;
  quoteError?: string;
  lastClose?: { price: number; date: string } | null;
  now: Date;
}): PriceReading {
  const { ticker, quote, quoteError, lastClose, now } = opts;
  const c = quote?.c;
  if (typeof c === "number" && c > 0) {
    const age = quoteAgeMs(quote, now.getTime());
    const asOf = age != null ? new Date(now.getTime() - age) : null;
    const open = isMarketOpen(now);
    const fresh = age != null && age <= STALE_QUOTE_MS;
    if (open && !fresh) {
      const mins = age != null ? Math.round(age / 60_000) : null;
      return {
        price: c,
        asOf: asOf?.toISOString() ?? null,
        ageMinutes: mins,
        live: false,
        warning:
          `Live price for $${ticker} is not current: $${c} printed ${asOf ? etStamp(asOf) + " ET" : "at an unknown time"}` +
          `${mins != null ? ` (${mins} minutes ago)` : ""}. Treat it, and every distance measured from it, as unconfirmed.`,
        warningShort: `Price is ${mins != null ? `${mins} min` : "of unknown age"} old — $${c}${asOf ? ` at ${etStamp(asOf)}` : ""}`,
      };
    }
    return { price: c, asOf: asOf?.toISOString() ?? null, ageMinutes: age != null ? Math.round(age / 60_000) : null, live: open && fresh, warning: null, warningShort: null };
  }
  if (lastClose) {
    return {
      price: lastClose.price,
      asOf: lastClose.date,
      ageMinutes: null,
      live: false,
      warning:
        `Live price for $${ticker} unavailable (${reasonOf(quoteError)}) — using the last close $${lastClose.price} (${closeStamp(lastClose.date)}). ` +
        `Distances to averages and levels are measured from that close, not today's price.`,
      warningShort: `Live price unavailable — using ${closeStamp(lastClose.date)} close $${lastClose.price}`,
    };
  }
  return {
    price: null,
    asOf: null,
    ageMinutes: null,
    live: false,
    warning: `Live price for $${ticker} unavailable (${reasonOf(quoteError)}); this result has no price.`,
    warningShort: "Live price unavailable",
  };
}
