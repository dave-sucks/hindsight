/**
 * Agent Watch — is the agent reviewing this name on its own schedule?
 *
 * A watched name the agent revisits on a cadence is an "Agent Watch"; one
 * that just sits on the list is a plain "Watching". The difference is a
 * single review schedule, and this is where every surface asks the
 * question so the row, the sheet and the agent can't disagree.
 *
 * Separate from `defaults.ts` because that module pulls `node:crypto` and
 * the watch row renders on the client.
 */

import { scheduleDays, shapeOf } from "./condition";

/** True when the agent reviews this name on a schedule of its own. */
export function isAgentWatched(triggers: unknown): boolean {
  return agentWatchDays(triggers) != null;
}

/** Days between the agent's reviews, or null when it isn't scheduled. */
export function agentWatchDays(triggers: unknown): number | null {
  if (!Array.isArray(triggers)) return null;
  for (const t of triggers) {
    const days = scheduleDays(shapeOf((t as { predicate?: unknown })?.predicate));
    if (days != null && days > 0) return days;
  }
  return null;
}

/** The one-line explanation, wherever Agent Watch is shown. */
export function agentWatchTooltip(days: number | null): string {
  if (days == null) return "You watch this. The agent doesn't review it.";
  if (days === 1) return "The agent reviews this every day.";
  if (days === 7) return "The agent reviews this every week.";
  if (days === 30) return "The agent reviews this every month.";
  return `The agent reviews this every ${days} days.`;
}
