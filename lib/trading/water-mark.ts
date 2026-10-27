/**
 * The high since we bought (the low, for a short) and its opposite, kept on
 * the Position by the five-minute trigger check before it reads the trails.
 *
 * Each pass takes the live price and, for a position held since before
 * today's open, the session's high and low off the same Alpaca snapshot
 * (regular hours only), so a spike between two passes still counts. The
 * close pass reads the finished day's bar, for a high in the last minutes.
 */

import { prisma } from "@/lib/prisma";
import { getTodaySessionBars } from "@/lib/alpaca";
import { freshQuotePrice } from "@/lib/market-data/quote-age";
import { isMarketOpen, sessionOpenAt } from "@/lib/market-hours";
import type { LiveQuote, LiveQuoteResult } from "@/lib/market-data/live-quote";

export interface WaterMarks {
  peakPrice: number | null;
  peakAt: Date | null;
  troughPrice: number | null;
  troughAt: Date | null;
}

export interface MarkedPosition extends WaterMarks {
  id: string;
  symbol: string;
  direction: string;
  openedAt: Date;
}

const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** The marks this quote moves, or null when it moves none. Only a live price in the session counts. Pure. */
export function nextWaterMarks(pos: MarkedPosition, quote: LiveQuote | null | undefined, now: Date): Partial<WaterMarks> | null {
  const price = freshQuotePrice(quote, now);
  if (!quote || price == null || !isMarketOpen(now)) return null;
  const today = etDay(now);
  // The day's high and low may predate a buy made today, and only Alpaca's bar is regular hours only.
  const wholeSession = quote.source === "alpaca" && etDay(new Date(quote.t * 1000)) === today && pos.openedAt < sessionOpenAt(today);
  const high = Math.max(price, wholeSession && quote.h != null ? quote.h : price);
  const low = Math.min(price, wholeSession && quote.l != null ? quote.l : price);
  return movedMarks(pos, high, low, now);
}

/** The marks the finished day's regular-session bar moves, for a position held since before that day's open. Pure. */
export function dayBarMarks(pos: MarkedPosition, bar: { high: number; low: number } | undefined, now: Date): Partial<WaterMarks> | null {
  if (!bar || !(pos.openedAt < sessionOpenAt(etDay(now)))) return null;
  return movedMarks(pos, bar.high, bar.low, now);
}

/** Only a new extreme moves a mark; a mark is never lowered. */
function movedMarks(pos: MarkedPosition, high: number, low: number, now: Date): Partial<WaterMarks> | null {
  const long = pos.direction !== "SHORT";
  const peak = long ? high : low;
  const trough = long ? low : high;
  const out: Partial<WaterMarks> = {};
  if (pos.peakPrice == null || (long ? peak > pos.peakPrice : peak < pos.peakPrice)) Object.assign(out, { peakPrice: peak, peakAt: now });
  if (pos.troughPrice == null || (long ? trough < pos.troughPrice : trough > pos.troughPrice)) Object.assign(out, { troughPrice: trough, troughAt: now });
  return Object.keys(out).length > 0 ? out : null;
}

/** Brings each position's marks up to date from its quote, one write per position that moved; returns them as they now stand. */
export async function raiseWaterMarks<T extends MarkedPosition>(
  positions: T[],
  quotes: Record<string, LiveQuoteResult>,
  now: Date,
): Promise<T[]> {
  return saveMarks(positions, (p) => nextWaterMarks(p, quotes[p.symbol.toUpperCase()]?.quote, now));
}

/** The close pass: every open position held since before today's open takes the day's high and low off its finished bar. */
export async function raiseMarksFromDayBars(now: Date): Promise<number> {
  const open = await prisma.position.findMany({
    where: { status: "OPEN", openedAt: { lt: sessionOpenAt(etDay(now)) } },
    select: { id: true, symbol: true, direction: true, openedAt: true, peakPrice: true, peakAt: true, troughPrice: true, troughAt: true },
  });
  if (open.length === 0) return 0;
  const bars = await getTodaySessionBars(Array.from(new Set(open.map((p) => p.symbol))), undefined, now, "trigger-check");
  const saved = await saveMarks(open, (p) => dayBarMarks(p, bars[p.symbol.toUpperCase()], now));
  return saved.filter((p, i) => p !== open[i]).length;
}

async function saveMarks<T extends MarkedPosition>(positions: T[], nextFor: (p: T) => Partial<WaterMarks> | null): Promise<T[]> {
  return Promise.all(
    positions.map(async (p) => {
      const next = nextFor(p);
      if (!next) return p;
      try {
        // Guarded on the values read, so an overlapping pass can never lower a mark.
        const { count } = await prisma.position.updateMany({
          where: { id: p.id, peakPrice: p.peakPrice, troughPrice: p.troughPrice },
          data: next,
        });
        return count > 0 ? { ...p, ...next } : p;
      } catch (e) {
        console.error(`[water-mark] ${p.symbol} position ${p.id}: high not saved this pass: ${e instanceof Error ? e.message : String(e)}`);
        return p;
      }
    }),
  );
}
