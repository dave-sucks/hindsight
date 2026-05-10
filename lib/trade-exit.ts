/**
 * Position exit condition evaluation — TRAILING + MANUAL only.
 *
 * Fix #0 (docs/MORNING_RUN_V2_DESIGN.md) gutted the PRICE_TARGET and
 * TIME_BASED branches and the NEAR_TARGET / NEAR_STOP PositionManagementAction
 * writes. Per-thesis triggers in lib/agent/triggers/* are now the single
 * source of truth for "should this position close?" — the trigger evaluator's
 * 5-min cron evaluates the agent's PRICE_ABOVE / PRICE_BELOW EXIT triggers
 * and spawns a tactical-run that decides via close_position.
 *
 * What's left:
 *   - TRAILING — explicit per-position behavior the agent OPTS IN to via
 *     manage_position.set_trailing_stop. Different semantic from triggers:
 *     trailing peak math, not predicate evaluation. Stays callable; the
 *     price-monitor cron gates the call on exitStrategy === "TRAILING".
 *   - MANUAL — new default for new positions. Never auto-closes.
 *   - targetProximity / stopProximity helpers — still useful for the
 *     near-target email in price-monitor.ts.
 *
 * Existing legacy rows on Position.exitStrategy ("PRICE_TARGET", "TIME_BASED")
 * are effectively MANUAL — checkExitConditions early-returns when the strategy
 * isn't TRAILING. The column stays for legacy-row tolerance; remove once
 * production has zero non-TRAILING/MANUAL OPEN positions.
 */

import type { PositionModel } from "@/lib/generated/prisma/models";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExitSignal {
  reason: "STOP";
  label: string;
}

// ─── Core evaluator (pure, synchronous, easily testable) ─────────────────────

export function evaluateExitStrategy(
  position: Pick<
    PositionModel,
    | "direction"
    | "exitStrategy"
    | "trailingStopPct"
  >,
  currentPrice: number,
  peakPrice: number
): ExitSignal | null {
  if (position.exitStrategy !== "TRAILING") return null;

  const isLong = position.direction === "LONG";
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

// ─── Proximity helpers ────────────────────────────────────────────────────────

/**
 * Returns how close (0–1) the position is to its target.
 * 1.0 = at target, 0 = at entry. Still used by price-monitor's
 * near-target email path.
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

/**
 * Returns how close (0–1) the position is to its stop loss.
 * 1.0 = at stop, 0 = far from stop. Still useful for telemetry / future
 * informational surfaces; no longer drives auto-action after Fix #0.
 */
export function stopProximity(
  position: Pick<PositionModel, "direction" | "avgCost" | "stopLoss">,
  currentPrice: number
): number {
  if (!position.stopLoss) return 0;
  const totalRange = Math.abs(position.avgCost - position.stopLoss);
  if (totalRange === 0) return 0;
  const distanceToStop =
    position.direction === "LONG"
      ? position.avgCost - currentPrice   // positive when price drops toward stop
      : currentPrice - position.avgCost;  // positive when price rises toward stop
  return Math.max(0, Math.min(1, distanceToStop / totalRange));
}

// ─── Main export: called by price-monitor for TRAILING positions only ───────

/**
 * Evaluates exit conditions for a TRAILING position. No-op for any other
 * exitStrategy — per-thesis triggers handle non-trailing exits.
 *
 * Side effects: calls closeOpenPosition when the trailing stop fires.
 * No PositionManagementAction writes; no NEAR_* alerts.
 */
export async function checkExitConditions(
  position: PositionModel,
  currentPrice: number,
  storedPeakPrice?: number | null,
): Promise<void> {
  if (position.exitStrategy !== "TRAILING") return;
  const peak = storedPeakPrice ?? position.peakPrice ?? position.avgCost;
  const signal = evaluateExitStrategy(position, currentPrice, peak);
  if (!signal) return;
  // Lazy import to avoid circular dependency
  const { closeOpenPosition } = await import("@/lib/actions/closeTrade.actions");
  await closeOpenPosition(position.id, signal.reason, undefined, "price_monitor");
}
