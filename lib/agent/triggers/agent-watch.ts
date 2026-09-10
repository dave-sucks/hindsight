/**
 * Agent Watch — is the agent reviewing this name on its own schedule?
 *
 * A watched name the agent revisits on a cadence is an "Agent Watch"; one
 * that just sits on the list is a plain "Watching". The difference is a
 * single `REVIEW_CADENCE` trigger, and this is where every surface asks the
 * question so the row, the sheet and the agent can't disagree.
 *
 * Separate from `defaults.ts` because that module pulls `node:crypto` and
 * the watch row renders on the client.
 */

/** True when the agent reviews this name on a schedule of its own. */
export function isAgentWatched(triggers: unknown): boolean {
  return agentWatchDays(triggers) != null;
}

/**
 * Days between the agent's reviews, or null when it isn't scheduled.
 *
 * Two predicates put a name on a schedule today. REVIEW_CADENCE is the real
 * one, counted from the last actual review. TIME_ELAPSED is the older,
 * worse one: anchored to when the thesis was written, so reviewing it never
 * resets it — it just nags on its cooldown. Both are read here because both
 * genuinely mean "the agent comes back to this on its own", and a pill that
 * ignored the second told you a name was unwatched while it was being
 * reviewed. TIME_ELAPSED is being deleted; when it is, this loop loses a
 * branch and nothing else changes.
 */
export function agentWatchDays(triggers: unknown): number | null {
  if (!Array.isArray(triggers)) return null;
  let fallback: number | null = null;
  for (const t of triggers) {
    const rung = t as { action?: string; predicate?: { kind?: string; days?: unknown } };
    const p = rung?.predicate;
    const days = typeof p?.days === "number" && p.days > 0 ? p.days : null;
    if (days == null) continue;
    if (p?.kind === "REVIEW_CADENCE") return days;
    // A time-elapsed REVIEW is a schedule in all but name. It only counts
    // when nothing better is on the row.
    if (p?.kind === "TIME_ELAPSED" && rung.action === "REVIEW") {
      fallback ??= days;
    }
  }
  return fallback;
}

/** The one-line explanation, wherever Agent Watch is shown. */
export function agentWatchTooltip(days: number | null): string {
  if (days == null) return "You watch this. The agent doesn't review it.";
  if (days === 1) return "The agent reviews this every day.";
  if (days === 7) return "The agent reviews this every week.";
  if (days === 30) return "The agent reviews this every month.";
  return `The agent reviews this every ${days} days.`;
}
