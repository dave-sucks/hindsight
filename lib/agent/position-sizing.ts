/**
 * position-sizing.ts — pure position-sizing math, no I/O.
 *
 * Kept free of prisma/alpaca imports so it's unit-testable in isolation and
 * reusable across tools (place_trade's entry band, manage_position's scale-in
 * ceiling) and the analyst Settings UI. See docs/plans/SCALE_INTO_WINNERS.md.
 *
 * The config expresses sizing as a BAND, not a ceiling:
 *
 *   minPositionSize ──────── floor ──────── ceiling ──────── maxPositionSize
 *                                             └── on LIVE, additionally
 *                                                 throttled by realMaxPosition
 *                                                 (the "live promotion cap")
 *
 * `realMaxPosition` is NOT a peer of `maxPositionSize`. It's a temporary
 * promotion throttle: run a freshly-promoted analyst small with real money,
 * then raise it toward `maxPositionSize` once the seat proves out. The UI
 * labels it "Live promotion cap"; the column keeps its legacy name.
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
 * Fallback per-entry cap when an analyst has no ceiling configured at all.
 * Matches place_trade's historical inline fallback.
 */
export const DEFAULT_POSITION_CAP = 5000;

export interface PositionBandInput {
  /** ResearchRun environment — "LIVE" activates the promotion cap. */
  environment?: string;
  /** AgentConfig.minPositionSize. 0/undefined = no floor. */
  minPositionSize?: number;
  /** AgentConfig.maxPositionSize. */
  maxPositionSize?: number;
  /** AgentConfig.realMaxPosition — the live promotion cap. LIVE only. */
  realMaxPosition?: number;
}

export interface PositionBand {
  /**
   * Smallest notional a single entry may be, after clamping (see
   * `floorClampedByCeiling`). 0 means no floor is enforced.
   */
  floor: number;
  /** Largest notional a single entry may be. null = no ceiling configured. */
  ceiling: number | null;
  /**
   * Which configured field produced `ceiling` — used verbatim in the
   * place_trade rejection message so the agent knows which knob bound it.
   */
  ceilingLabel: "max position size" | "live promotion cap";
  /**
   * True when the configured floor sat ABOVE the effective ceiling and was
   * clamped down to it. The normal cause is a live promotion cap set below the
   * analyst's paper floor: legitimate (the throttle is the point), so the band
   * collapses to a single size rather than making every trade unplaceable.
   */
  floorClampedByCeiling: boolean;
}

/**
 * Resolve the legal notional band for ONE entry.
 *
 * Ceiling:  PAPER → maxPositionSize
 *           LIVE  → min(maxPositionSize, realMaxPosition), so a forgotten
 *                   promotion cap can't accidentally uncap a live order.
 * Floor:    minPositionSize, clamped to the ceiling if it exceeds it.
 */
export function positionBand(input: PositionBandInput): PositionBand {
  const { environment, minPositionSize, maxPositionSize, realMaxPosition } =
    input;

  const isLive = environment === "LIVE";
  const usesPromotionCap = isLive && realMaxPosition != null;

  const rawCeiling = usesPromotionCap
    ? Math.min(maxPositionSize ?? Infinity, realMaxPosition as number)
    : maxPositionSize;
  const ceiling =
    rawCeiling != null && Number.isFinite(rawCeiling) ? rawCeiling : null;

  const rawFloor =
    minPositionSize != null && Number.isFinite(minPositionSize) && minPositionSize > 0
      ? minPositionSize
      : 0;
  const floorClampedByCeiling = ceiling != null && rawFloor > ceiling;

  return {
    floor: floorClampedByCeiling ? (ceiling as number) : rawFloor,
    ceiling,
    ceilingLabel: usesPromotionCap ? "live promotion cap" : "max position size",
    floorClampedByCeiling,
  };
}

/**
 * Max total position value (cost basis + pending add) allowed on the
 * add_to_position path. Mirrors place_trade's effective per-entry ceiling and
 * then applies the scale-in multiple:
 *   PAPER → maxPositionSize × multiple
 *   LIVE  → min(maxPositionSize, realMaxPosition) × multiple
 * so realMaxPosition still bounds the LIVE base (× the multiple). Falls back to
 * DEFAULT_POSITION_CAP when no cap is configured, matching place_trade.
 *
 * The minPositionSize floor deliberately does NOT apply here — it governs
 * ENTRIES. A $2k add onto an existing $12k winner is a legitimate scale-in,
 * not an undersized position.
 */
export function scaleInCeiling(opts: {
  environment: string;
  maxPositionSize?: number;
  realMaxPosition?: number;
  multiple?: number;
}): number {
  const multiple = opts.multiple ?? SCALE_IN_CEILING_MULTIPLE;
  const { ceiling } = positionBand(opts);
  return (ceiling ?? DEFAULT_POSITION_CAP) * multiple;
}

// ─── Authoring-time sizing sanity (P1-40 companion — the RARE sizing bug) ────

/**
 * A thesis whose targetSizePct works out below the analyst's minPositionSize
 * floor is self-rejecting: place_trade Guardrail 5b will refuse the entry by
 * the thesis's own numbers, even on a valid fired ENTER. RARE carried 4%
 * (≈$4k) against a $5k floor — the agent never sees "your own plan is below
 * the floor" until the one afternoon the entry window is open. Post-#523 this
 * got worse: the ENTER gate compels resolution, so a sub-floor thesis pushes
 * the agent toward archiving a good name.
 *
 * This helper is the Layer-1 authoring-time check, shared by record_thesis
 * and update_thesis: given live equity, does the intended size clear the
 * band's floor? Returns null when fine (or unknowable), or a rejection
 * payload with the exact numbers the agent needs to fix the call. Pure —
 * the caller fetches equity and decides fail-open on fetch errors.
 */
export function subFloorTargetSize(opts: {
  targetSizePct: number;
  equity: number;
  environment: "PAPER" | "LIVE";
  minPositionSize?: number;
  maxPositionSize?: number;
  realMaxPosition?: number;
}): { floorDollars: number; floorPct: number; intendedDollars: number } | null {
  const { targetSizePct, equity } = opts;
  if (!Number.isFinite(equity) || equity <= 0) return null;
  if (!Number.isFinite(targetSizePct) || targetSizePct <= 0) return null;
  const band = positionBand(opts);
  if (band.floor <= 0) return null;
  const intendedDollars = (targetSizePct / 100) * equity;
  if (intendedDollars >= band.floor) return null;
  // Round the required % UP to one decimal so the suggested value always
  // clears the floor when the agent retries with it verbatim.
  const floorPct = Math.ceil((band.floor / equity) * 1000) / 10;
  return { floorDollars: band.floor, floorPct, intendedDollars };
}
