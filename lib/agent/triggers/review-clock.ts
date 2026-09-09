/**
 * The review clock, read off a thesis's triggers (DAV-209 / DAV-225).
 *
 * The clock is a `REVIEW_CADENCE` trigger, not a column, so every surface
 * that shows one — the watch row, the sheet, the agent's own reader — goes
 * through here rather than each parsing the JSON its own way.
 */

import type { TriggerPredicate } from "./types";
import { resolvedCadenceDays } from "./defaults";

/**
 * Days on this thesis's clock, or null when it is on no schedule.
 *
 * Tolerates the malformed rows legacy theses carry: a bad rung just doesn't
 * supply a clock, it doesn't fail the read.
 */
export function reviewClockDays(triggers: unknown): number | null {
  if (!Array.isArray(triggers)) return null;
  return resolvedCadenceDays(triggers as Array<{ predicate: TriggerPredicate }>);
}

/** "Every day" / "Every week" / "Every 3 days" — the same words everywhere. */
export function reviewClockLabel(days: number | null): string {
  if (days == null) return "No schedule";
  if (days === 1) return "Every day";
  if (days === 7) return "Every week";
  if (days === 30) return "Every month";
  return `Every ${days} days`;
}
