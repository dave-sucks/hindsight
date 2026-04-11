/**
 * Position exit condition evaluation.
 * Called by the price-monitor Inngest cron for every OPEN position.
 * closeOpenPosition is in lib/actions/closeTrade.actions.ts.
 */

import { prisma } from "@/lib/prisma";
import type { PositionModel } from "@/lib/generated/prisma/models";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExitSignal {
  reason: "TARGET" | "STOP" | "TIME";
  label: string;
}

// ─── Peak price helper (for trailing stop) ───────────────────────────────────

/**
 * Returns the highest (LONG) or lowest (SHORT) price seen in PRICE_CHECK events.
 * Falls back to avgCost if no events yet.
 */
export async function getPeakPrice(position: PositionModel): Promise<number> {
  const events = await prisma.positionEvent.findMany({
    where: {
      positionId: position.id,
      eventType: "PRICE_CHECK",
      priceAt: { not: null },
    },
    select: { priceAt: true },
  });

  const prices = events
    .map((e) => e.priceAt!)
    .concat(position.avgCost);

  return position.direction === "LONG"
    ? Math.max(...prices)
    : Math.min(...prices);
}

// ─── Core evaluator (pure, synchronous, easily testable) ─────────────────────

export function evaluateExitStrategy(
  position: Pick<
    PositionModel,
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
  const isLong = position.direction === "LONG";

  switch (position.exitStrategy) {
    case "PRICE_TARGET": {
      // Target hit
      if (isLong && position.targetPrice && currentPrice >= position.targetPrice) {
        return { reason: "TARGET", label: "Target price reached" };
      }
      if (!isLong && position.targetPrice && currentPrice <= position.targetPrice) {
        return { reason: "TARGET", label: "Target price reached" };
      }
      // Stop loss
      if (position.stopLoss) {
        if (isLong && currentPrice <= position.stopLoss) {
          return { reason: "STOP", label: "Stop loss triggered" };
        }
        if (!isLong && currentPrice >= position.stopLoss) {
          return { reason: "STOP", label: "Stop loss triggered" };
        }
      }
      return null;
    }

    case "TIME_BASED": {
      if (position.exitDate && new Date() >= new Date(position.exitDate)) {
        return { reason: "TIME", label: "Hold duration expired" };
      }
      return null;
    }

    case "TRAILING": {
      const trailPct = position.trailingStopPct ?? 5;
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
 * Returns how close (0–1) the position is to its target.
 * 1.0 = at target, 0 = at entry.
 */
export function targetProximity(
  position: Pick<PositionModel, "direction" | "avgCost" | "targetPrice">,
  currentPrice: number
): number {
  if (!position.targetPrice) return 0;
  const totalRange = Math.abs(position.targetPrice - position.avgCost);
  if (totalRange === 0) return 0;
  const progress =
    position.direction === "LONG"
      ? currentPrice - position.avgCost
      : position.avgCost - currentPrice;
  return Math.max(0, Math.min(1, progress / totalRange));
}

// ─── Main export: called by price-monitor ────────────────────────────────────

/**
 * Evaluates exit conditions for a position.
 * Writes a NEAR_TARGET event if within 10% of target.
 * Calls closeOpenPosition (imported lazily to avoid circular dep).
 */
export async function checkExitConditions(
  position: PositionModel,
  currentPrice: number
): Promise<void> {
  const peak = await getPeakPrice(position);
  const signal = evaluateExitStrategy(position, currentPrice, peak);

  // Check near-target (write event if ≥90% of the way there, only once)
  if (!signal && position.targetPrice) {
    const proximity = targetProximity(position, currentPrice);
    if (proximity >= 0.9) {
      const pct = Math.round(proximity * 100);
      // Only write NEAR_TARGET if we haven't already in the last 2 hours
      const recentNear = await prisma.positionEvent.findFirst({
        where: {
          positionId: position.id,
          eventType: "NEAR_TARGET",
          createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
        },
      });
      if (!recentNear) {
        await prisma.positionEvent.create({
          data: {
            positionId: position.id,
            eventType: "NEAR_TARGET",
            description: `${position.symbol} approaching target: $${currentPrice.toFixed(2)} (${pct}% to target $${position.targetPrice.toFixed(2)})`,
            priceAt: currentPrice,
          },
        });
      }
    }
  }

  if (!signal) return;

  // Lazy import to avoid circular dependency
  const { closeOpenPosition } = await import("@/lib/actions/closeTrade.actions");
  await closeOpenPosition(position.id, signal.reason, currentPrice, undefined, "price_monitor");
}
