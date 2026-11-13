/**
 * load-market-numbers.ts — reads what the market numbers are made of
 * (market-numbers.ts): one quotes call for the indexes, the sector funds and
 * VIXY; SPY's row in the 06:30 indicator snapshot (the regime); and, for a
 * book, the earnings calendar's next 14 days (the trigger check's own call,
 * fetchEarningsWindow) against the book's held and watched stocks. Read only;
 * never throws: a part that can't be read comes back empty and the text says so.
 */
import { prisma } from "@/lib/prisma";
import type { AlpacaCredentials } from "@/lib/alpaca";
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import { EARNINGS_LOOKAHEAD_DAYS, fetchEarningsWindow } from "@/lib/agent/triggers/earnings";
import { buildMarketNumbers, MARKET_SYMBOLS, type MarketNumbers } from "@/lib/market-data/market-numbers";

const warn = (what: string) => (err: unknown) => {
  console.warn(`[market-numbers] ${what} couldn't be read: ${err instanceof Error ? err.message : err}`);
  return null;
};

/** The book's stocks: held (an open position or a holding thesis) and watched. */
async function loadBook(book: { accountId: string; environment: string }): Promise<{ held: string[]; watched: string[] }> {
  const [positions, theses] = await Promise.all([
    prisma.position.findMany({ where: { accountId: book.accountId, environment: book.environment, status: "OPEN" }, select: { symbol: true } }),
    prisma.thesis.findMany({
      // The book as the Market Reviewer reads it: its analysts' theses in this account and environment.
      where: { status: { in: ["HOLDING", "WATCHING"] }, researchRun: { agentConfig: { accountId: book.accountId, tradingEnvironment: book.environment } } },
      select: { ticker: true, status: true },
    }),
  ]);
  const held = new Set([...positions.map((p) => p.symbol.toUpperCase()), ...theses.filter((t) => t.status === "HOLDING").map((t) => t.ticker.toUpperCase())]);
  return { held: [...held], watched: theses.map((t) => t.ticker.toUpperCase()).filter((t) => !held.has(t)) };
}

export async function loadMarketNumbers(args: { now?: Date; creds?: AlpacaCredentials; book?: { accountId: string; environment: string } } = {}): Promise<MarketNumbers> {
  const now = args.now ?? new Date();
  const [quotes, spy, window, book] = await Promise.all([
    // The trigger check has first claim on quotes (quote-budget.ts).
    getLiveQuotes(MARKET_SYMBOLS, { caller: "other", creds: args.creds, now }),
    loadIndicatorSnapshots(["SPY"], now).then((m) => m.get("SPY") ?? null, warn("SPY's snapshot")),
    args.book ? fetchEarningsWindow({ now, lookaheadDays: EARNINGS_LOOKAHEAD_DAYS }) : null,
    args.book ? loadBook(args.book).catch(warn("the book")) : null,
  ]);
  // A calendar or a book that couldn't be read gives no dates: the text says so rather than "none".
  const upcoming = window && !window.error && book ? window.upcoming : null;
  return buildMarketNumbers({ now, quotes, spy, upcoming, book: args.book ? (book ?? { held: [], watched: [] }) : null });
}
