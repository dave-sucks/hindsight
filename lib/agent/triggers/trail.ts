/**
 * Where a trail trigger fires, as one pure function — the evaluator, the
 * thesis sheet's price levels and the ladder-health block the agents read all
 * call it, so the line on screen is the line that sells.
 */

/**
 * The price a "below N% from the high since we bought" trail fires at, or
 * null with no tracked peak yet. LONG: N% below the high-water mark; SHORT:
 * N% above the low-water mark.
 */
export function trailFireLevel(pct: number, ctx: { peak: number | null | undefined; isLong: boolean }): number | null {
  const peak = ctx.peak;
  if (peak == null || peak <= 0) return null;
  return ctx.isLong ? peak * (1 - pct / 100) : peak * (1 + pct / 100);
}
