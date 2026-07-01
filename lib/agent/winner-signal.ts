/**
 * winner-signal.ts — pure "is this held position a running winner?" math.
 *
 * Single source of truth shared by needs-action.ts (the RUNNING_WINNER
 * attention flag) and resolved-thesis.ts (surfacing gain + progress on every
 * HOLDING row so the agent sees P&L inline instead of cross-referencing
 * get_portfolio_context). No I/O — pure + unit-tested.
 *
 * See docs/plans/SCALE_INTO_WINNERS.md (PR3 — the attention fix). The premise:
 * the morning agent skips any HOLDING with needsAction=null, so a winner that
 * quietly reaches its target is never re-underwritten. This flags the winner
 * so the agent stops on it and decides press / hold / take.
 */

/**
 * Fraction of the entry→target distance covered before a HOLDING is flagged as
 * a running winner. 0.75 = "three-quarters of the way to target" — near the
 * decision point the framework centers on (target = decision point, not exit),
 * and self-limiting (only fires near/past target, not on every green day).
 * Tunable; calibrate from run reviews.
 */
export const RUNNING_WINNER_PROGRESS_THRESHOLD = 0.75;

/**
 * Minimum unrealized gain to qualify as a "winner" worth pressing. Guards
 * against firing on a thesis with a trivially-close target (e.g. a 4% target
 * where 75% progress is a 3% gain — not a winner to press). Tunable.
 */
export const RUNNING_WINNER_MIN_GAIN_PCT = 8;

export interface WinnerSignal {
  /** Unrealized gain %, direction-aware (positive = winning). */
  unrealizedGainPct: number;
  /**
   * Fraction of the entry→target distance covered (0 = at entry, 1 = at
   * target, >1 = past target). Null when there's no valid target on the
   * correct side of entry, so progress can't be defined.
   */
  progressToTarget: number | null;
  /** True when price has reached or exceeded the target. */
  pastTarget: boolean;
  /** True when this qualifies as a running winner (progress + gain floor). */
  isRunningWinner: boolean;
}

/**
 * Compute the winner signal for a held position. Returns null when the inputs
 * can't support the math (no valid avgCost or current price) — the caller
 * treats null as "not a running winner, no P&L to surface."
 */
export function computeWinnerSignal(opts: {
  direction: string | null | undefined;
  avgCost: number | null | undefined;
  targetPrice: number | null | undefined;
  currentPrice: number | null | undefined;
}): WinnerSignal | null {
  const { direction, avgCost, targetPrice, currentPrice } = opts;
  if (avgCost == null || avgCost <= 0) return null;
  if (currentPrice == null || currentPrice <= 0) return null;

  const isShort = direction === "SHORT";
  const unrealizedGainPct = isShort
    ? ((avgCost - currentPrice) / avgCost) * 100
    : ((currentPrice - avgCost) / avgCost) * 100;

  let progressToTarget: number | null = null;
  if (targetPrice != null && targetPrice > 0) {
    // Denominator is the entry→target distance; only meaningful when the
    // target sits on the correct side of entry (above for LONG, below for
    // SHORT). A mis-set target (e.g. LONG target ≤ entry) yields null.
    const denom = isShort ? avgCost - targetPrice : targetPrice - avgCost;
    if (denom > 0) {
      const numer = isShort ? avgCost - currentPrice : currentPrice - avgCost;
      progressToTarget = numer / denom;
    }
  }

  const pastTarget = progressToTarget != null && progressToTarget >= 1;
  const isRunningWinner =
    progressToTarget != null &&
    progressToTarget >= RUNNING_WINNER_PROGRESS_THRESHOLD &&
    unrealizedGainPct >= RUNNING_WINNER_MIN_GAIN_PCT;

  return { unrealizedGainPct, progressToTarget, pastTarget, isRunningWinner };
}
