/**
 * The review clock, read off a thesis's triggers (DAV-225).
 *
 * The clock is a `REVIEW_CADENCE` trigger, not a column. This lives apart
 * from `defaults.ts` because that module pulls `node:crypto` and the watch
 * row renders on the client.
 */

/** Days on this thesis's clock, or null when it is on no schedule. */
export function reviewClockDays(triggers: unknown): number | null {
  if (!Array.isArray(triggers)) return null;
  for (const t of triggers) {
    const p = (t as { predicate?: { kind?: string; days?: unknown } })?.predicate;
    if (p?.kind !== "REVIEW_CADENCE") continue;
    if (typeof p.days === "number" && p.days > 0) return p.days;
  }
  return null;
}

/** "Every day" / "Every week" / "Every 3 days" — the same words everywhere. */
export function reviewClockLabel(days: number | null): string {
  if (days == null) return "No schedule";
  if (days === 1) return "Every day";
  if (days === 7) return "Every week";
  if (days === 30) return "Every month";
  return `Every ${days} days`;
}
