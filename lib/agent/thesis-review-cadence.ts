/**
 * Thesis review cadence — derive the next-scheduled-review timestamp from
 * a thesis's horizon.
 *
 * Single source of truth for the horizon → days mapping. Both record_thesis
 * and update_thesis call this so a thesis minted today and one reviewed
 * today land on the same review schedule.
 *
 * Cadence (mirrors the prompt's horizon table in lib/agent/system-prompt.ts):
 *   CATALYST   — 1d  (binary event horizon, daily re-look until event)
 *   TRADE      — 1d  (tight timeframe, daily check while held)
 *   TARGET     — 7d  (open-ended swing, weekly hygiene)
 *   COMPOUNDER — 30d (long hold, monthly hygiene)
 *
 * Returns null when horizon is null/unknown — legacy theses without a
 * horizon don't get an auto-review schedule. Caller decides whether to
 * leave the field unchanged or null it out.
 */

export type ReviewHorizon = "CATALYST" | "TRADE" | "TARGET" | "COMPOUNDER";

const DAY_MS = 24 * 60 * 60 * 1000;

const DAYS_BY_HORIZON: Record<ReviewHorizon, number> = {
  CATALYST: 1,
  TRADE: 1,
  TARGET: 7,
  COMPOUNDER: 30,
};

export function computeNextReviewAt(
  horizon: string | null | undefined,
  now: Date,
): Date | null {
  if (!horizon) return null;
  const days = DAYS_BY_HORIZON[horizon as ReviewHorizon];
  if (days == null) return null;
  return new Date(now.getTime() + days * DAY_MS);
}
