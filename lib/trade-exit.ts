/**
 * Trade exit condition evaluation.
 * Called by the price-monitor Inngest cron for every OPEN trade.
 * closeTrade is implemented in DAV-34 (lib/actions/closeTrade.actions.ts).
 */

import { prisma } from "@/lib/prisma";
import type { TradeModel } from "@/lib/generated/prisma/models";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExitSignal {
  reason: "TARGET" | "STOP" | "TIME";
  label: string;
}

// ─── Peak price helper (for trailing stop) ───────────────────────────────────

/**
 * Returns the highest (LONG) or lowest (SHORT) price seen in PRICE_CHECK events.
 * Falls back to entryPrice if no events yet.
 */
export async function getPeakPrice(trade: TradeModel): Promise<number> {
  const events = await prisma.tradeEvent.findMany({
    where: {
      tradeId: trade.id,
      eventType: "PRICE_CHECK",
      priceAt: { not: null },
    },
    select: { priceAt: true },
  });

  const prices = events
    .map((e) => e.priceAt!)
    .concat(trade.entryPrice);

  return trade.direction === "LONG"
    ? Math.max(...prices)
    : Math.min(...prices);
}

// ─── Core evaluator (pure, synchronous, easily testable) ─────────────────────

export function evaluateExitStrategy(
  trade: Pick<
    TradeModel,
    | "direction"
    | "exitStrategy"
    | "targetPrice"
    | "stopLoss"
    | "exitDate"
    | "trailingStopPct"
  >,
  currentPrice: number,
  peakPrice: number
): ExitSignal | null {
  const isLong = trade.direction === "LONG";

  switch (trade.exitStrategy) {
    case "PRICE_TARGET": {
      // Target hit
      if (isLong && trade.targetPrice && currentPrice >= trade.targetPrice) {
        return { reason: "TARGET", label: "Target price reached" };
      }
      if (!isLong && trade.targetPrice && currentPrice <= trade.targetPrice) {
        return { reason: "TARGET", label: "Target price reached" };
      }
      // Stop loss
      if (trade.stopLoss) {
        if (isLong && currentPrice <= trade.stopLoss) {
          return { reason: "STOP", label: "Stop loss triggered" };
        }
        if (!isLong && currentPrice >= trade.stopLoss) {
          return { reason: "STOP", label: "Stop loss triggered" };
        }
      }
      return null;
    }

    case "TIME_BASED": {
      if (trade.exitDate && new Date() >= new Date(trade.exitDate)) {
        return { reason: "TIME", label: "Hold duration expired" };
      }
      return null;
    }

    case "TRAILING": {
      const trailPct = trade.trailingStopPct ?? 5;
      const trailingStopPrice = isLong
        ? peakPrice * (1 - trailPct / 100)
        : peakPrice * (1 + trailPct / 100);

      if (isLong && currentPrice <= trailingStopPrice) {
        return {
          reason: "STOP",
          label: `Trailing stop hit (${trailPct}% from peak $${peakPrice.toFixed(2)})`,
        };
      }
      if (!isLong && currentPrice >= trailingStopPrice) {
        return {
          reason: "STOP",
          label: `Trailing stop hit (${trailPct}% from peak $${peakPrice.toFixed(2)})`,
        };
      }
      return null;
    }

    case "MANUAL":
    default:
      return null; // Never auto-closes
  }
}

// ─── NEAR_TARGET detection ────────────────────────────────────────────────────

/**
 * Returns how close (0–1) the trade is to its target.
 * 1.0 = at target, 0 = at entry.
 */
export function targetProximity(
  trade: Pick<TradeModel, "direction" | "entryPrice" | "targetPrice">,
  currentPrice: number
): number {
  if (!trade.targetPrice) return 0;
  const totalRange = Math.abs(trade.targetPrice - trade.entryPrice);
  if (totalRange === 0) return 0;
  const progress =
    trade.direction === "LONG"
      ? currentPrice - trade.entryPrice
      : trade.entryPrice - currentPrice;
  return Math.max(0, Math.min(1, progress / totalRange));
}

// ─── Main export: called by price-monitor ────────────────────────────────────

/**
 * Evaluates exit conditions for a trade.
 * Writes a NEAR_TARGET event if within 10% of target.
 * Calls closeTrade (imported lazily to avoid circular dep with DAV-34).
 */
export async function checkExitConditions(
  trade: TradeModel,
  currentPrice: number
): Promise<void> {
  const peak = await getPeakPrice(trade);
  const signal = evaluateExitStrategy(trade, currentPrice, peak);

  // Check near-target (write event if ≥90% of the way there, only once)
  if (!signal && trade.targetPrice) {
    const proximity = targetProximity(trade, currentPrice);
    if (proximity >= 0.9) {
      const pct = Math.round(proximity * 100);
      // Only write NEAR_TARGET if we haven't already in the last price check
      const recentNear = await prisma.tradeEvent.findFirst({
        where: {
          tradeId: trade.id,
          eventType: "NEAR_TARGET",
          createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // last 2h
        },
      });
      if (!recentNear) {
        await prisma.tradeEvent.create({
          data: {
            tradeId: trade.id,
            eventType: "NEAR_TARGET",
            description: `${trade.ticker} approaching target: $${currentPrice.toFixed(2)} (${pct}% to target $${trade.targetPrice.toFixed(2)})`,
            priceAt: currentPrice,
          },
        });
      }
    }
  }

  if (!signal) return;

  // Lazy import to avoid circular dependency with DAV-34
  const { closeTrade } = await import("@/lib/actions/closeTrade.actions");
  await closeTrade(trade.id, signal.reason, currentPrice);
}
