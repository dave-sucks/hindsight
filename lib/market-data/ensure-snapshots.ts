/**
 * ensure-snapshots.ts — compute a ticker's indicator snapshot now, when the
 * trigger evaluator needs one the 06:30 job didn't write.
 *
 * The morning job snapshots the book as it stood at 06:30. A stock added at
 * 11:00 — a chat add, a writer mint, a chart trigger Dave puts on from the
 * popover — would otherwise read false on every chart kind until tomorrow
 * (DAV-247 review). The evaluator calls this for tickers whose rungs read
 * the chart and have no fresh snapshot, a few per pass, and stores the
 * result so the next pass (and the daily run) reads it like any other.
 *
 * One function computes a snapshot for both paths, so the morning job and a
 * mid-day fill can't disagree.
 */

import { prisma } from "@/lib/prisma";
import { getDailyBars } from "@/lib/alpaca";
import { computePriceStructure, type DailyBar } from "@/lib/market-data/price-structure";
import { toIndicatorSnapshot, type IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { CHART_SESSIONS, getBenchmarkBars } from "@/lib/market-data/benchmark-bars";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";

/** Fills per evaluator pass — bounds one 5-minute tick's extra work (~1–2s each). */
export const MAX_FILLS_PER_PASS = 8;

/** Compute one ticker's snapshot from a year of bars and store it. Null when there are too few bars. */
export async function computeAndStoreSnapshot(
  ticker: string,
  spyBars?: DailyBar[],
): Promise<IndicatorSnapshot | null> {
  const { feed, bars } = await getDailyBars(ticker, CHART_SESSIONS);
  const structure = computePriceStructure({ bars, spyBars });
  if (!structure) return null;
  const snapshot = toIndicatorSnapshot(structure, bars);
  await prisma.tickerIndicators.upsert({
    where: { ticker_asOf: { ticker, asOf: snapshot.asOf } },
    create: { ticker, asOf: snapshot.asOf, volumeFeed: feed, snapshot: snapshot as unknown as object },
    update: { volumeFeed: feed, snapshot: snapshot as unknown as object, computedAt: new Date() },
  });
  return snapshot;
}

/**
 * The newest snapshot for each ticker, computing up to `maxFills` missing
 * ones on the spot. Fail-open per ticker: a fill that errors leaves that
 * ticker out (its chart kinds read false this pass, and it's tried again
 * next pass).
 */
export async function ensureIndicatorSnapshots(
  tickers: string[],
  opts: { now?: Date; maxFills?: number } = {},
): Promise<Map<string, IndicatorSnapshot>> {
  const now = opts.now ?? new Date();
  const have = await loadIndicatorSnapshots(tickers, now).catch(() => new Map<string, IndicatorSnapshot>());
  const missing = Array.from(new Set(tickers)).filter((t) => !have.has(t)).slice(0, opts.maxFills ?? MAX_FILLS_PER_PASS);
  if (missing.length === 0) return have;
  const spy = await getBenchmarkBars("SPY").catch(() => undefined);
  for (const t of missing) {
    try {
      const snap = await computeAndStoreSnapshot(t, spy);
      if (snap) {
        have.set(t, snap);
        console.log(`[indicators] filled a missing snapshot for ${t} (asOf ${snap.asOf})`);
      }
    } catch (err) {
      console.warn(`[indicators] fill failed for ${t}:`, err instanceof Error ? err.message : err);
    }
  }
  return have;
}
