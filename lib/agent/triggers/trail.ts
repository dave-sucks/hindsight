/**
 * Where a TRAILING_FROM_HIGH trigger fires, as one pure function — the
 * evaluator, the thesis sheet's price levels and the ladder-health block
 * the agents read all call it, so the line on screen is the line that sells.
 *
 * `atrMultiple` (DAV-294, playbook E5) widens the trail for a volatile
 * stock: the give-back is the LARGER of `pct` and `atrMultiple` × the
 * stock's ATR(14). A quiet name and a jumpy one should not wear the same
 * 12%. It only ever widens, never tightens, so a missing ATR falls back to
 * `pct` — the behaviour before it existed — and every surface that can draw
 * the line must pass the same ATR or the line on screen stops being the
 * line that sells.
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
 * The give-back this trail actually uses, as a percent of the peak: the
 * larger of the written percent and `atrMultiple` × ATR, when both the
 * multiple and the stock's ATR are known. Falls back to the written percent
 * — never tighter than what the analyst wrote.
 */
export function effectiveTrailPct(
  p: Trail,
  ctx: { peak: number | null | undefined; atr?: number | null },
): number {
  const { atrMultiple } = p;
  const atr = ctx.atr;
  const peak = ctx.peak;
  if (atrMultiple == null || atrMultiple <= 0) return p.pct;
  if (atr == null || !(atr > 0) || peak == null || !(peak > 0)) return p.pct;
  const fromAtr = ((atrMultiple * atr) / peak) * 100;
  return Math.max(p.pct, Math.round(fromAtr * 10) / 10);
}

/** True when the stock's range is what set the give-back, not the written percent. */
export function trailWidenedByRange(
  p: Trail,
  ctx: { peak: number | null | undefined; atr?: number | null },
): boolean {
  return effectiveTrailPct(p, ctx) > p.pct;
}

/**
 * The price this trail fires at, or null when it has no live level (no
 * tracked peak yet, or not armed). LONG: the give-back below the high-water
 * mark; SHORT: above the low-water mark.
 */
export function trailFireLevel(
  p: Trail,
  ctx: { peak: number | null | undefined; avgCost?: number | null; isLong: boolean; atr?: number | null },
): number | null {
  const peak = ctx.peak;
  if (peak == null || peak <= 0) return null;
  if (!trailArmed(p, { peak, avgCost: ctx.avgCost, isLong: ctx.isLong })) return null;
  const pct = effectiveTrailPct(p, { peak, atr: ctx.atr });
  return ctx.isLong ? peak * (1 - pct / 100) : peak * (1 + pct / 100);
}
