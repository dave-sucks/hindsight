/**
 * needs-action-line.ts — the work-list flag in one sentence, for a person
 * (DAV-304).
 *
 * `needsAction` is what puts a stock on the daily run's work list, and it
 * lived for the seconds a run was thinking and was then thrown away — so Dave
 * could not open a stock and see whether its review flag had fired, let alone
 * test it. The thesis sheet renders this. Same facts the agent reads off the
 * structured object, in the words the app uses everywhere else.
 *
 * Its own file, not a function on needs-action.ts: that module reaches
 * `node:crypto` through the trigger evaluator, so a client component can only
 * import the TYPE from it. Type imports are erased; this one is real code.
 */
import type { NeedsAction } from "@/lib/agent/needs-action";

export function needsActionLine(na: NeedsAction): string {
  switch (na.kind) {
    case "PROMOTED_AWAITING_RESOLUTION":
      return "Promoted to live money — the next run has to re-enter it, defer it, or kill it.";
    case "TRIGGER_FIRED":
      return `A trigger fired and nothing has answered it: ${na.summary}`;
    case "TRIGGER_MATCHING_NOW":
      return `A trigger is true right now: ${na.predicateSummary}${na.livePrice != null ? ` (price $${na.livePrice.toFixed(2)})` : ""}`;
    case "UNPROTECTED_GAIN":
      return (
        `Up ${na.unrealizedGainPct.toFixed(1)}% with ` +
        (na.flooredGainPct == null
          ? "no floor under it"
          : `a floor that only locks in ${na.flooredGainPct.toFixed(1)}%${na.floorSummary ? ` (${na.floorSummary})` : ""}`) +
        " — raise the floor or say why not."
      );
    case "RESEARCH_STALE":
      return na.freshness === "missing"
        ? "No deep research has ever been written for this stock."
        : `The research is ${na.daysOld ?? "?"} days old, past its ${na.threshold ?? "?"}-day mark — refresh it or say it still holds.`;
    case "REVIEW_DUE":
      if (na.pendingFirstReview) return "Awaiting its first research.";
      return na.daysOverdue > 0
        ? `Review is ${na.daysOverdue} day${na.daysOverdue === 1 ? "" : "s"} overdue.`
        : "Review is due today.";
  }
}
