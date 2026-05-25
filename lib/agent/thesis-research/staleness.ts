/**
 * staleness.ts — single source of truth for "is this thesis's deep
 * research old enough to require a refresh before trading?"
 *
 * Used by:
 *   - lib/agent/tools/get-theses.ts — annotates every returned thesis
 *     with `researchAge` so the agent can see freshness at a glance.
 *   - lib/agent/run-input.ts — pre-loads `researchAge` into the
 *     per-thesis context block so the daily-run prompt has it without
 *     a get_theses round-trip.
 *   - lib/agent/system-prompts/intraday-tactical.ts — same.
 *   - (Phase 2) lib/agent/tools/place-trade.ts — staleness gate refuses
 *     trades on `missing` or `stale` research unless a refresh dispatch
 *     fired earlier in this run.
 *
 * Threshold: STALE_DAYS = 14. Trade-off between false-positive refresh
 * churn (too short → ~90s per refresh × N theses) and stale-research
 * trades (too long → agent acts on pre-earnings context after results
 * have dropped). 14 days covers most catalysts: earnings every ~90
 * days, but the post-earnings 14-day window is the high-volatility
 * one where research matters most. After 14 days the world has
 * usually moved enough to warrant a re-anchor.
 *
 * Tunable in one place. See docs/plans/THESIS_LIFECYCLE_FIX.md
 * "Cross-cutting design decisions" for the trade-off discussion.
 */

export const STALE_DAYS = 14;

/**
 * Three-bucket freshness classification.
 *
 *   missing — `researchUpdatedAt` is null. The thesis exists but never
 *             went through the V2 thesis-writer pipeline. Common on
 *             legacy seeds (user-added watchlist items, pre-V2
 *             discovery mints).
 *   stale   — research exists but is older than STALE_DAYS.
 *   fresh   — research exists and is within STALE_DAYS.
 */
export type Freshness = "missing" | "stale" | "fresh";

export interface ResearchAge {
  /** Whole days since the research was last written. Null when missing. */
  daysOld: number | null;
  /** Bucket for prompt rendering + Phase-2 gate decisions. */
  freshness: Freshness;
  /** ISO timestamp of the last write. Null when missing. */
  lastWrittenAt: string | null;
}

/**
 * Classify the age of a thesis's deep research from its
 * `researchUpdatedAt` column. Pure function; safe to call in any layer.
 *
 * Examples:
 *   classifyResearchAge(null)
 *     → { daysOld: null, freshness: "missing", lastWrittenAt: null }
 *
 *   classifyResearchAge(<3 days ago>)
 *     → { daysOld: 3, freshness: "fresh", lastWrittenAt: "2026-05-21..." }
 *
 *   classifyResearchAge(<20 days ago>)
 *     → { daysOld: 20, freshness: "stale", lastWrittenAt: "2026-05-04..." }
 */
export function classifyResearchAge(
  researchUpdatedAt: Date | null | undefined,
): ResearchAge {
  if (!researchUpdatedAt) {
    return { daysOld: null, freshness: "missing", lastWrittenAt: null };
  }
  const daysOld = Math.floor(
    (Date.now() - researchUpdatedAt.getTime()) / 86_400_000,
  );
  const freshness: Freshness = daysOld > STALE_DAYS ? "stale" : "fresh";
  return {
    daysOld,
    freshness,
    lastWrittenAt: researchUpdatedAt.toISOString(),
  };
}

/**
 * Short label for prompt rendering. Compact form the agent can grep on.
 * Examples: "fresh (3d)", "stale (20d)", "missing".
 */
export function formatResearchAge(age: ResearchAge): string {
  if (age.freshness === "missing") return "missing";
  return `${age.freshness} (${age.daysOld}d)`;
}
