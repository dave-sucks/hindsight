/**
 * Where a TRAILING_FROM_HIGH trigger fires, as one pure function — the
 * evaluator, the thesis sheet's price levels and the ladder-health block
 * the agents read all call it, so the line on screen is the line that sells.
 *
 * `armAtGainPct` (DAV-250) keeps the trail off until the position has once
 * been up that much from entry: a TARGET position isn't trailed tight from
 * day one — its floor governs until it has earned a gain worth protecting.
 * An unarmed trail has no level: it fires nowhere, and every display must
 * say so rather than draw a line that isn't live.
 */

import type { TriggerPredicate } from "./types";

type Trail = Extract<TriggerPredicate, { kind: "TRAILING_FROM_HIGH" }>;

/** True once the peak has cleared the arming gain (always true with none). */
export function trailArmed(
  p: Trail,
  ctx: { peak: number; avgCost?: number | null; isLong: boolean },
): boolean {
  if (p.armAtGainPct == null || p.armAtGainPct <= 0) return true;
  const avg = ctx.avgCost;
  if (avg == null || avg <= 0) return false;
  const peakGain = ctx.isLong ? ((ctx.peak - avg) / avg) * 100 : ((avg - ctx.peak) / avg) * 100;
  return peakGain >= p.armAtGainPct;
}

/**
 * The price this trail fires at, or null when it has no live level (no
 * tracked peak yet, or not armed). LONG: `pct` below the high-water mark;
 * SHORT: `pct` above the low-water mark.
 */
export function trailFireLevel(
  p: Trail,
  ctx: { peak: number | null | undefined; avgCost?: number | null; isLong: boolean },
): number | null {
  const peak = ctx.peak;
  if (peak == null || peak <= 0) return null;
  if (!trailArmed(p, { peak, avgCost: ctx.avgCost, isLong: ctx.isLong })) return null;
  return ctx.isLong ? peak * (1 - p.pct / 100) : peak * (1 + p.pct / 100);
}
