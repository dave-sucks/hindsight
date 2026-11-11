/**
 * value-at-quotes.ts — the account valued at the app's own prices, never the
 * broker's. The broker marks holdings at after-hours and overnight prints
 * (MU at $756.70 at 2:37 AM on Nov 11, against its $725.11 close); the app's
 * price is the latest trade in the session and the close stamped at the bell
 * outside it (lib/market-data/live-quote.ts). Pure.
 */
import type { LiveQuoteResult } from "@/lib/market-data/live-quote";
import type { FundingEvent } from "@/lib/portfolio/contributions";

/** A position as the broker lists it: what is owned, not what it is worth. */
export interface BrokerHolding {
  symbol: string;
  qty: string;
  side?: string;
  current_price: string;
}

export interface PricedBook {
  /** Cash and every holding at its price. */
  value: number;
  long: number;
  /** As a positive number. */
  short: number;
  held: Array<{ ticker: string; qty: number; price: number; value: number }>;
  /** The New York day of the close every holding is priced at; null in the session, or when one had no quote. */
  closeOf: string | null;
  /** Holdings no vendor priced: valued at the broker's price, so the value is no close. */
  unquoted: string[];
}

const nyDay = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export function priceBook(cash: number, positions: readonly BrokerHolding[], quotes: Record<string, LiveQuoteResult>, open: boolean): PricedBook {
  const held: PricedBook["held"] = [];
  const unquoted: string[] = [];
  let latest = 0;
  for (const p of positions) {
    const ticker = p.symbol.toUpperCase();
    const size = Math.abs(parseFloat(p.qty)) || 0;
    const qty = p.side === "short" || parseFloat(p.qty) < 0 ? -size : size;
    const q = quotes[ticker]?.quote;
    const price = q && q.c > 0 ? q.c : parseFloat(p.current_price) || 0;
    if (!q || !(q.c > 0)) unquoted.push(ticker);
    else latest = Math.max(latest, q.t);
    held.push({ ticker, qty, price, value: qty * price });
  }
  const long = held.reduce((s, h) => s + Math.max(0, h.value), 0);
  const short = held.reduce((s, h) => s + Math.max(0, -h.value), 0);
  return {
    value: cash + long - short,
    long,
    short,
    held,
    closeOf: !open && !unquoted.length && latest > 0 ? nyDay(latest) : null,
    unquoted,
  };
}

/** The broker's prior close: `last_equity`, and the day it is the close of (`balance_asof`). */
export interface PriorClose {
  equity: number | null;
  asOf: string | null;
}

/**
 * The day's change, net of transfers, for the session the prices are from:
 * today in the session, the close's day outside it.
 *
 * `last_equity` is the close of `balance_asof`. While that day is before the
 * session, the change is the value against it, less every transfer dated
 * after it (a deposit before today's open, dated today, included). Overnight
 * after a close the broker moves `balance_asof` to that close's own day
 * (between 2:37 and 3:16 AM ET after Tue Nov 10, 2026); the session's change
 * is then already inside `last_equity`, and it is `closed`: that day's figure
 * from its 8 PM digest. Without one, null: the change can't be read.
 */
export function dayChangeAt(
  book: PricedBook,
  prior: PriorClose,
  transfers: FundingEvent[],
  today: string,
  closed?: { dollars: number; pct: number } | null,
): { dollars: number; pct: number } | null {
  const session = book.closeOf ?? today;
  if (prior.asOf && prior.asOf >= session) return closed ?? null;
  if (prior.equity == null || !Number.isFinite(prior.equity) || prior.equity <= 0) return null;
  const since = prior.asOf;
  const moved = transfers.filter((e) => (since ? e.date > since : e.date >= session)).reduce((sum, e) => sum + e.amount, 0);
  const dollars = book.value - prior.equity - moved;
  return { dollars, pct: (dollars / prior.equity) * 100 };
}
