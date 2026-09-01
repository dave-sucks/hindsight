/**
 * staleness.ts — single source of truth for "is this thesis's deep
 * research old enough to warrant a refresh before the next decision?"
 *
 * Used by:
 *   - lib/agent/tools/get-theses.ts — annotates every returned thesis
 *     with `researchAge` so the agent can see freshness at a glance.
 *   - lib/agent/run-input.ts — pre-loads `researchAge` into the
 *     per-thesis context block so the daily-run prompt has it without
 *     a get_theses round-trip.
 *   - lib/inngest/functions/tactical-run.ts — same, single-thesis.
 *   - lib/agent/tools/wait-for-thesis-refresh.ts — annotates the
 *     refreshed-thesis excerpt the agent reads after a refresh lands.
 *
 * Not used by place_trade. The Layer-1 staleness gate that lived at
 * place_trade was removed per docs/plans/REVIEW_REFRESH_CADENCE.md
 * (P1-1) — research-age decisions belong to the REVIEW flow, not the
 * TRADE flow, and the per-horizon REVIEW cadence is the durable
 * mechanism that keeps research current. Staleness is now advisory
 * input to the agent's reasoning, not a tool-level veto.
 *
 * Per-horizon thresholds — each horizon's threshold tracks its review
 * cadence: CATALYST/TRADE refresh weekly (events move fast), TARGET
 * monthly (swings have time), COMPOUNDER quarterly (multi-year hold).
 * See `STALE_DAYS_BY_HORIZON` below for values + rationale.
 */

import type { Horizon } from "@/lib/agent/horizon-policy";

/**
 * Per-horizon staleness thresholds. Each value is the day count at or
 * below which research is "fresh"; strictly above flips to "stale".
 *
 *   CATALYST   — 7 days. Event windows are short. After 7d the world
 *                has moved enough to warrant a re-anchor.
 *   TRADE      — 7 days. maxHoldDays is typically 14; research can't
 *                be older than half the hold window.
 *   TARGET     — 30 days. Open-ended swing. Monthly refresh keeps the
 *                thesis aligned without daily churn.
 *   COMPOUNDER — 90 days. Multi-year hold; quarterly is sufficient.
 */
export const STALE_DAYS_BY_HORIZON: Record<Horizon, number> = {
  CATALYST: 7,
  TRADE: 7,
  TARGET: 30,
  COMPOUNDER: 90,
};

/**
 * Hard cap on research age for a stock we do NOT own yet.
 *
 * The per-horizon numbers below answer "how fast does this KIND of thesis
 * decay?" — a multi-year compounder genuinely can run a quarter between
 * deep refreshes once you hold it, because the thing you're re-checking is
 * a long arc.
 *
 * A watchlist name asks a different question: "should I buy this today?"
 * That decision is made against today's tape, and it should never rest on
 * research from three months ago. Before this cap, every Compounder watch
 * was unflaggable for 90 days — GD, GEV and VST sat at 80 days and ETN at
 * 77, all reported FRESH, all reviewed and waved through on 2026-08-28,
 * with GEV's buy level sitting AT the money on 11-week-old reasoning.
 *
 * 35 days ≈ one earnings cycle: long enough that a quiet name isn't
 * re-researched every week, short enough that no buy decision is made on
 * work from the previous quarter.
 */
export const WATCHLIST_STALE_DAYS_CAP = 35;

/**
 * Default threshold when horizon is null (PENDING seeds, edge cases).
 * Matches the most conservative horizon threshold (7 days) to bias
 * toward "refresh" rather than "looks fresh."
 */
const DEFAULT_STALE_DAYS = 7;

/**
 * @deprecated Use STALE_DAYS_BY_HORIZON or pass the thesis's horizon
 * to classifyResearchAge. Kept as an alias for callers outside the
 * audited surface — equal to the conservative default.
 */
export const STALE_DAYS = DEFAULT_STALE_DAYS;

/**
 * Three-bucket freshness classification.
 *
 *   missing — `researchUpdatedAt` is null. The thesis exists but never
 *             went through the V2 thesis-writer pipeline. Common on
 *             legacy seeds (user-added watchlist items, pre-V2
 *             discovery mints).
 *   stale   — research exists but is older than the horizon's threshold.
 *   fresh   — research exists and is within the horizon's threshold.
 */
export type Freshness = "missing" | "stale" | "fresh";

export interface ResearchAge {
  /** Whole days since the research was last written. Null when missing. */
  daysOld: number | null;
  /** Bucket for prompt rendering. */
  freshness: Freshness;
  /** ISO timestamp of the last write. Null when missing. */
  lastWrittenAt: string | null;
  /**
   * Threshold (in days) used to bucket this row. Surfaced so prompts
   * can render "stale: 32d > 30d threshold" without re-deriving it.
   * Null when missing (no threshold applied — research absent entirely).
   */
  horizonThreshold: number | null;
}

/**
 * Classify the age of a thesis's deep research from its
 * `researchUpdatedAt` column. Pure function; safe to call in any layer.
 *
 * Pass the thesis's `horizon` for per-horizon-tuned classification.
 * When horizon is null/undefined (PENDING seeds, edge cases), falls
 * back to the conservative 7-day default.
 *
 * Examples:
 *   classifyResearchAge(null)
 *     → { daysOld: null, freshness: "missing", lastWrittenAt: null,
 *         horizonThreshold: null }
 *
 *   classifyResearchAge(<3 days ago>, "CATALYST")
 *     → { daysOld: 3, freshness: "fresh", ..., horizonThreshold: 7 }
 *
 *   classifyResearchAge(<60 days ago>, "COMPOUNDER")
 *     → { daysOld: 60, freshness: "fresh", ..., horizonThreshold: 90 }
 *
 *   classifyResearchAge(<60 days ago>, "TARGET")
 *     → { daysOld: 60, freshness: "stale", ..., horizonThreshold: 30 }
 */
export function classifyResearchAge(
  researchUpdatedAt: Date | null | undefined,
  horizon?: Horizon | null,
  /**
   * Thesis status. Anything other than HOLDING is a name we don't own, so
   * the watchlist cap applies on top of the horizon threshold. OMITTED =
   * horizon threshold only (unchanged behavior for callers that can't see
   * status).
   */
  status?: string | null,
): ResearchAge {
  if (!researchUpdatedAt) {
    return {
      daysOld: null,
      freshness: "missing",
      lastWrittenAt: null,
      horizonThreshold: null,
    };
  }
  const daysOld = Math.floor(
    (Date.now() - researchUpdatedAt.getTime()) / 86_400_000,
  );
  const base = horizon ? STALE_DAYS_BY_HORIZON[horizon] : DEFAULT_STALE_DAYS;
  // Held names decay on their horizon's clock; anything we don't own yet is
  // additionally capped, because its next decision is "buy this today?".
  const threshold =
    status != null && status !== "HOLDING"
      ? Math.min(base, WATCHLIST_STALE_DAYS_CAP)
      : base;
  const freshness: Freshness = daysOld > threshold ? "stale" : "fresh";
  return {
    daysOld,
    freshness,
    lastWrittenAt: researchUpdatedAt.toISOString(),
    horizonThreshold: threshold,
  };
}

/**
 * Short label for prompt rendering. Compact form the agent can grep on.
 * Examples: "fresh (3d / 7d)", "stale (32d / 30d)", "missing".
 */
export function formatResearchAge(age: ResearchAge): string {
  if (age.freshness === "missing") return "missing";
  const threshold = age.horizonThreshold;
  return threshold != null
    ? `${age.freshness} (${age.daysOld}d / ${threshold}d)`
    : `${age.freshness} (${age.daysOld}d)`;
}
