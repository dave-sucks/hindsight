/**
 * The stored side of the Street feed (street-consensus.ts): one
 * StreetConsensus row per stock per day. A failed or malformed pull writes
 * nothing, so yesterday's row stands.
 */
import { prisma } from "@/lib/prisma";
import { STREET_ENDPOINTS, nasdaqAnalyst, nyDay, parseStreet, type StreetFacts } from "@/lib/market-data/street-consensus";

const ONE_DAY_MS = 86_400_000;
/** A stock the feed stops serving shows its last row this long, then reads as absent. */
const KEEP_DAYS = 14;

/** Pull the three calls and store today's row. Throws, writing nothing, on any failure. */
export async function pullStreet(ticker: string, now: Date = new Date()): Promise<StreetFacts> {
  const T = ticker.toUpperCase();
  const [targetprice, forecast, momentum] = await Promise.all(STREET_ENDPOINTS.map((e) => nasdaqAnalyst(T, e)));
  const facts = parseStreet(T, { targetprice, "earnings-forecast": forecast, "estimate-momentum": momentum }, nyDay(now));
  await prisma.streetConsensus.upsert({
    where: { ticker_asOf: { ticker: T, asOf: facts.asOf } },
    create: { ...facts, fetchedAt: now },
    update: { ...facts, fetchedAt: now },
  });
  return facts;
}

/** Pull each stock in turn, `gapMs` apart; one stock's failure never stops the others. */
export async function pullStreetMany(tickers: string[], gapMs = 500): Promise<{ written: number; missed: string[] }> {
  let written = 0;
  const missed: string[] = [];
  for (const [i, ticker] of tickers.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
    try {
      await pullStreet(ticker);
      written++;
    } catch (err) {
      missed.push(`${ticker}(${err instanceof Error ? err.message.slice(0, 60) : "error"})`);
    }
  }
  return { written, missed };
}

/** The newest stored row for each ticker, from the last 14 New York days. */
export async function newestStreetRows(tickers: string[], now: Date = new Date()): Promise<Map<string, StreetFacts & { fetchedAt: Date }>> {
  if (tickers.length === 0) return new Map();
  const rows = await prisma.streetConsensus.findMany({
    where: { ticker: { in: tickers.map((t) => t.toUpperCase()) }, asOf: { gte: nyDay(new Date(now.getTime() - KEEP_DAYS * ONE_DAY_MS)) } },
    orderBy: { asOf: "desc" },
    distinct: ["ticker"],
  });
  return new Map(rows.map((r) => [r.ticker, r]));
}

/** The newest row from about a month ago (the newest on or before 30 days back, within 45), to say which way the Street moved. */
export async function monthAgoStreetRows(tickers: string[], now: Date = new Date()): Promise<Map<string, StreetFacts>> {
  if (tickers.length === 0) return new Map();
  const rows = await prisma.streetConsensus.findMany({
    where: {
      ticker: { in: tickers.map((t) => t.toUpperCase()) },
      asOf: { lte: nyDay(new Date(now.getTime() - 30 * ONE_DAY_MS)), gte: nyDay(new Date(now.getTime() - 45 * ONE_DAY_MS)) },
    },
    orderBy: { asOf: "desc" },
    distinct: ["ticker"],
  });
  return new Map(rows.map((r) => [r.ticker, r]));
}

/** The newest row, pulled fresh first when it is missing or more than a day old. A failed pull keeps the old row. */
export async function streetFor(ticker: string, now: Date = new Date()): Promise<StreetFacts | null> {
  const T = ticker.toUpperCase();
  const newest = (await newestStreetRows([T], now)).get(T) ?? null;
  if (newest && now.getTime() - new Date(newest.fetchedAt).getTime() <= ONE_DAY_MS) return newest;
  try {
    return await pullStreet(T, now);
  } catch (err) {
    console.warn(`[street-consensus] ${T}: pull failed, ${newest ? `keeping ${newest.asOf}` : "nothing stored"}: ${err instanceof Error ? err.message : err}`);
    return newest;
  }
}
