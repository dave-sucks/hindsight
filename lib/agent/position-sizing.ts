/**
 * position-sizing.ts — pure position-sizing math, no I/O.
 *
 * Kept free of prisma/alpaca imports so it's unit-testable in isolation and
 * reusable across tools (manage_position today; place_trade's entry cap could
 * share the base-cap logic later). See docs/plans/SCALE_INTO_WINNERS.md.
 */

/**
 * Scale-in ceiling multiple (SCALE_INTO_WINNERS.md, PR1).
 *
 * A held winner may grow to this multiple of the normal per-entry cap via
 * add_to_position. This deliberately lets a proven position exceed the
 * single-entry cap that place_trade enforces (1×) — pressing conviction into a
 * working thesis is the point. Was an inline 1.5; bumped to 2 per principal.
 */
export const SCALE_IN_CEILING_MULTIPLE = 2;

/**
 * Max total position value (cost basis + pending add) allowed on the
 * add_to_position path. Mirrors place_trade's effective per-entry cap and then
 * applies the scale-in multiple:
 *   PAPER → maxPositionSize × multiple
 *   LIVE  → min(maxPositionSize, realMaxPosition) × multiple
 * so realMaxPosition still bounds the LIVE base (× the multiple). Falls back to
 * 5000 when no cap is configured, matching place_trade's fallback.
 */
export function scaleInCeiling(opts: {
  environment: string;
  maxPositionSize?: number;
  realMaxPosition?: number;
  multiple?: number;
}): number {
  const { environment, maxPositionSize, realMaxPosition } = opts;
  const multiple = opts.multiple ?? SCALE_IN_CEILING_MULTIPLE;
  const baseCap =
    environment === "LIVE" && realMaxPosition != null
      ? Math.min(maxPositionSize ?? Infinity, realMaxPosition)
      : maxPositionSize;
  const effectiveBase =
    baseCap != null && Number.isFinite(baseCap) ? baseCap : 5000;
  return effectiveBase * multiple;
}
