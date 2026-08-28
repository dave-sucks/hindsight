/**
 * Horizon policy — single source for per-horizon constants used by the
 * daily-run system prompt and the trade evaluator (post-mortem framing).
 *
 * The four horizons are:
 *   CATALYST   — trade built around a binary event (FDA, M&A, named earnings).
 *                Hold until the event resolves; ignore inter-event drift.
 *   TRADE      — momentum/pattern setup with a tight stop. Days-to-weeks.
 *                Bounded by maxHoldDays.
 *   TARGET     — swing trade with a defined upside number. Weeks-to-months.
 *                No time stop; exit at target / stop / invalidation.
 *   COMPOUNDER — long-term hold based on durable business quality. Months-to-
 *                years. Quarterly hygiene; never time-exits on price alone.
 *
 * Add new horizons here ONLY when adding actual code paths that branch on
 * them. The taxonomy is deliberately small.
 */

export type Horizon = "CATALYST" | "TRADE" | "TARGET" | "COMPOUNDER";

export const HORIZONS: readonly Horizon[] = [
  "CATALYST",
  "TRADE",
  "TARGET",
  "COMPOUNDER",
] as const;



/**
 * Derive the legacy hold-duration label from a horizon. Used by UI surfaces
 * that still render "Hold duration: SWING" while the `holdDuration` column
 * is being deprecated (THESIS_CLEANUP PR-2). Mapping matches the existing
 * `record_thesis` writer fallback exactly:
 *   COMPOUNDER → POSITION  (months-to-years)
 *   TARGET / TRADE / CATALYST → SWING  (everything bounded under ~quarters)
 *
 * DAY is intentionally never auto-picked — the no-overnight pattern is
 * driven by `AgentConfig.holdDurations` + the EOD-flatten cron, not by
 * the thesis row.
 *
 * Falls back to "SWING" when horizon is null so the UI never renders a
 * blank cell. The column itself goes away in PR-4.
 */
export type HoldDurationLabel = "DAY" | "SWING" | "POSITION";

export function holdDurationFromHorizon(
  horizon: Horizon | string | null | undefined,
): HoldDurationLabel {
  return horizon === "COMPOUNDER" ? "POSITION" : "SWING";
}
