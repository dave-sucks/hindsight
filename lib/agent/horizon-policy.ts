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
 * Default days-until-next-review for **held** theses (status=ACTIVE) when
 * the agent doesn't supply `next_review_at`. Used by record_thesis +
 * update_thesis to compute the housekeeping cadence and by the overdue-
 * review cron to decide when an active position needs another look.
 *
 * Rule of thumb: you need to look at this thesis at least this often to
 * keep the trade plan sane. Higher cadence = more attention required.
 * Held positions get reviewed more often than watchlist candidates —
 * different jobs (see WATCHING_FIRST_REVIEW_DAYS below).
 */
export const HORIZON_REVIEW_DAYS: Record<Horizon, number> = {
  CATALYST: 1,
  TRADE: 1,
  TARGET: 7,
  COMPOUNDER: 30,
};

/**
 * Default days-until-first-review for **WATCHING** theses (newly minted,
 * no position yet). Tracks the per-horizon hygiene-trigger cadence from
 * lib/agent/triggers/defaults.ts — not the held-side operational cadence.
 *
 * Why distinct: a WATCHING thesis has no position to manage; review
 * effort is just hygiene ("is the setup still valid?"). A held position
 * needs much more frequent attention because a stop fires or a target
 * gets hit. Pre-2026-05-19 record_thesis used HORIZON_REVIEW_DAYS for
 * both, which scheduled brand-new COMPOUNDER WATCHING theses for first
 * review 30 days out — too aggressive for a multi-year hold candidate.
 * Production data on 2026-05-19 showed avg-days-to-first-review:
 *
 *   COMPOUNDER  30  → should be 90
 *   TRADE        4  → roughly right (14d hygiene window)
 *   CATALYST   4.5  → should be 14
 *   TARGET       7  → roughly right
 *
 * Net effect was Monday after each Sunday discovery cron flooded the
 * tactical surface with REVIEW_DATE_HIT triggers. 2026-05-18: 28
 * REVIEW_DATE_HIT fires, most from theses minted the prior day.
 *
 * Values mirror each horizon's WATCHING template's TIME_ELAPSED hygiene
 * trigger in lib/agent/triggers/defaults.ts (14 / 14 / 30 / 90 days).
 *
 * A4 from docs/plans/SYSTEM_AUDIT_2026_05_19.md.
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
