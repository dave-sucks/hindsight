/**
 * Position sizing — three plain settings on the analyst, one helper.
 *
 *   Smallest trade   (AgentConfig.minPositionSize)  — a buy is never less.
 *   Largest trade    (AgentConfig.maxPositionSize)  — a buy is never more;
 *                                                     STRONG/HIGH conviction
 *                                                     buys exactly this.
 *   Most in one stock (AgentConfig.maxPositionTotal) — adding to a winner
 *                                                     stops here.
 *
 * Until 2026-09-08 there were two more numbers: `realMaxPosition`, a
 * "live promotion cap" that was a second largest-trade applying only to
 * live money (and only mattered when it was lower — one analyst), and a
 * hidden ×2 constant that decided how far adds could grow a position. Both
 * are gone: the cap folded into the largest trade, the constant became the
 * third setting so the principal can see and change it.
 *
 * The tool gate (place_trade / manage_position) and the Settings UI both
 * call these helpers, so the number on screen is the number that rejects
 * a trade.
 */

/**
 * Fallback per-entry cap when an analyst has no largest trade configured at
 * all. Matches place_trade's historical inline fallback.
 */
export const DEFAULT_POSITION_CAP = 5000;

/**
 * "Most in one stock" when the setting is unset (0/undefined): twice the
 * largest trade — the value every existing analyst was backfilled with.
 */
const DEFAULT_TOTAL_MULTIPLE = 2;

export interface PositionBandInput {
  /** AgentConfig.minPositionSize — the smallest trade. 0/undefined = no floor. */
  minPositionSize?: number;
  /** AgentConfig.maxPositionSize — the largest trade. */
  maxPositionSize?: number;
}

export interface PositionBand {
  /** Smallest notional a single entry may be. 0 = no floor. */
  floor: number;
  /** Largest notional a single entry may be. null = none configured. */
  ceiling: number | null;
  /**
   * True when the configured smallest trade sits above the largest — a
   * misconfiguration; the band collapses to the largest trade instead of
   * refusing every buy as both too small and too big.
   */
  floorClampedByCeiling: boolean;
}

export function positionBand(input: PositionBandInput): PositionBand {
  const { minPositionSize, maxPositionSize } = input;
  const ceiling =
    maxPositionSize != null && Number.isFinite(maxPositionSize) && maxPositionSize > 0
      ? maxPositionSize
      : null;
  const rawFloor =
    minPositionSize != null && Number.isFinite(minPositionSize) && minPositionSize > 0
      ? minPositionSize
      : 0;
  const floorClampedByCeiling = ceiling != null && rawFloor > ceiling;
  return {
    floor: floorClampedByCeiling ? (ceiling as number) : rawFloor,
    ceiling,
    floorClampedByCeiling,
  };
}

/**
 * The most this analyst may hold in one stock (cost basis + a pending add).
 * The setting when it is set; otherwise twice the largest trade. The
 * smallest-trade floor deliberately does NOT apply to adds — a $2k add onto
 * a $12k winner is a legitimate scale-in, not an undersized position.
 */
export function positionTotalCap(opts: {
  maxPositionSize?: number;
  maxPositionTotal?: number;
}): number {
  if (
    opts.maxPositionTotal != null &&
    Number.isFinite(opts.maxPositionTotal) &&
    opts.maxPositionTotal > 0
  ) {
    return opts.maxPositionTotal;
  }
  const { ceiling } = positionBand(opts);
  return (ceiling ?? DEFAULT_POSITION_CAP) * DEFAULT_TOTAL_MULTIPLE;
}

// ─── Entry size from the analyst's settings ─────────────────────────────────

/**
 * How much a new position is, in dollars: the analyst's own band, placed by
 * conviction. A normal thesis buys the smallest trade the analyst allows;
 * a STRONG or HIGH conviction thesis buys the largest.
 *
 * This replaces `Thesis.targetSizePct` (DAV-237, 2026-09-08): a percent of
 * portfolio the AGENT wrote on every thesis, which nothing but two refusal
 * gates ever read — place_trade always sized from the agent's `notional`
 * and clamped it to this band. Two numbers from the model, one from the
 * principal, and the principal's was the only one that ever bound. CYTK's
 * 4% guess under a $5,000 floor blocked a real buy crossing on 09-08.
 */
export function entrySizeForConviction(opts: {
  conviction?: string | null;
  band: PositionBand;
}): number {
  const { floor, ceiling } = opts.band;
  const largest = ceiling ?? (floor > 0 ? floor : DEFAULT_POSITION_CAP);
  const smallest = floor > 0 ? floor : largest;
  return opts.conviction === "STRONG" || opts.conviction === "HIGH" ? largest : smallest;
}
