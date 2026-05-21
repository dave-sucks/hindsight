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
 * Human-readable review cadence labels surfaced in the daily-run prompt's
 * Live Theses table. Tells the agent how often a thesis of this kind is
 * normally walked — so a COMPOUNDER getting hammered today doesn't get
 * panic-reviewed at the same intensity as a TRADE near its stop.
 */
export const HORIZON_REVIEW_CADENCE: Record<Horizon, string> = {
  CATALYST: "Daily — catalyst proximity",
  TRADE: "Daily — tight window",
  TARGET: "Weekly — let it breathe",
  COMPOUNDER: "Quarterly — fundamental shifts only",
};

/**
 * Human-readable exit-policy summary surfaced in the daily-run prompt
 * per thesis. The single most-load-bearing horizon-aware behavior:
 * the agent has to know what kind of trade this is to decide whether
 * a -3% move is a stop-tightening situation (TRADE) or noise (COMPOUNDER).
 */
export const HORIZON_EXIT_POLICY: Record<Horizon, string> = {
  CATALYST:
    "Hold through event. Exit at event resolution OR 30d past catalystDate. Inter-event price drift is noise.",
  TRADE:
    "Stop, target, or maxHoldDays — whichever fires first. Hard exits, no extensions.",
  TARGET:
    "Stop, target, or thesis invalidation. No time stop. Tolerate intra-month noise; the target is the thesis.",
  COMPOUNDER:
    "Broken thesis only. Ignore intra-quarter price moves under ~5%; only fundamental shifts (earnings, guidance, regulatory) warrant action.",
};

/**
 * Compact one-liner combining cadence + exit policy. Used in the Live
 * Theses table where space is tight and we want one row of guidance per
 * thesis without taking three lines.
 */
export function horizonHint(horizon: Horizon | null | undefined): string {
  if (!horizon) return "";
  const cadence = HORIZON_REVIEW_CADENCE[horizon];
  const policy = HORIZON_EXIT_POLICY[horizon];
  return `${cadence}. ${policy}`;
}

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
