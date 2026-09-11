/**
 * load-indicators.ts — read the latest TickerIndicators row per ticker.
 *
 * One query for a batch. A snapshot older than MAX_SNAPSHOT_AGE_DAYS is
 * ignored and logged: yesterday's 50-day is a fine stand-in for today's; a
 * fortnight-old one would put a stop on the wrong side of the average
 * without anyone noticing. Missing → the chart kinds read false.
 */

import { prisma } from "@/lib/prisma";
import {
  parseIndicatorSnapshot,
  type IndicatorSnapshot,
} from "@/lib/market-data/indicator-snapshot";

/** Covers a weekend plus a holiday. */
export const MAX_SNAPSHOT_AGE_DAYS = 5;

export async function loadIndicatorSnapshots(
  tickers: string[],
  now: Date = new Date(),
): Promise<Map<string, IndicatorSnapshot>> {
  const out = new Map<string, IndicatorSnapshot>();
  if (tickers.length === 0) return out;
  const rows = await prisma.tickerIndicators.findMany({
    where: { ticker: { in: Array.from(new Set(tickers)) } },
    orderBy: { asOf: "desc" },
    distinct: ["ticker"],
    select: { ticker: true, asOf: true, snapshot: true },
  });
  for (const r of rows) {
    const ageDays = (now.getTime() - Date.parse(`${r.asOf}T00:00:00Z`)) / 86_400_000;
    if (ageDays > MAX_SNAPSHOT_AGE_DAYS) {
      console.warn(`[indicators] ${r.ticker}: newest snapshot is ${r.asOf} (${Math.floor(ageDays)}d old) — ignored`);
      continue;
    }
    const snap = parseIndicatorSnapshot(r.snapshot);
    if (snap) out.set(r.ticker, snap);
  }
  return out;
}
