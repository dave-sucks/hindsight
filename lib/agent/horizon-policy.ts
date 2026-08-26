/**
 * Horizon policy — single source for per-horizon constants used by writers
 * (record_thesis nextReviewAt math), readers (daily-run system prompt), and
 * the trade evaluator (post-mortem framing).
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
 * Default days-until-next-review when the agent doesn't supply
 * `next_review_at`. Used by record_thesis to compute the housekeeping
 * cadence and by the overdue-review cron to decide when a thesis is stale.
 *
 * Rule of thumb: you need to look at this thesis at least this often to
 * keep the trade plan sane. Higher cadence = more attention required.
 */
export const HORIZON_REVIEW_DAYS: Record<Horizon, number> = {
  CATALYST: 1,
  TRADE: 1,
  TARGET: 7,
  COMPOUNDER: 30,
};

/**
 * Default days-until-first-review for **WATCHING** theses. Tracks the
 * per-horizon WATCHING-side hygiene cadence — not the held-side
 * operational cadence above.
 *
 * Consumed today by `scripts/fix-watching-next-review.ts` and pinned by
 * `lib/agent/horizon-policy.test.ts`. The constant exists so those
 * consumers typecheck on main; the broader cadence change in #291 was
 * closed pending the C-series rewrite. Keeping this export is a no-op
 * for runtime behavior — no code path reads it during a run.
 */
export const WATCHING_FIRST_REVIEW_DAYS: Record<Horizon, number> = {
  CATALYST: 14,
  TRADE: 14,
  TARGET: 30,
  COMPOUNDER: 90,
};

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
