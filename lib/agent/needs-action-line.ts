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
    case "SALE_DECLINED":
      return (
        `Sale declined ${na.lastDeclinedAt.slice(0, 10)}` +
        (na.declineCount > 1 ? ` (${na.declineCount}×)` : "") +
        (na.floorPrice != null ? `, still under $${na.floorPrice.toFixed(2)}` : "") +
        " — no new plan yet."
      );
    case "TRIGGER_FIRED":
      // The repeat line only exists once the same rung has asked twice
      // (DAV-323) — on a first ask there is no history worth a sentence.
      return (
        `A trigger fired and nothing has answered it: ${na.summary}` +
        (na.repeatLine ? ` ${na.repeatLine}` : "") +
        (na.alsoFired?.length
          ? ` Also fired since the last answer: ${na.alsoFired.map((x) => `${x.summary}${x.count > 1 ? ` (${x.count}×)` : ""}`).join("; ")}.`
          : "")
      );
    case "TRIGGER_MATCHING_NOW":
      return `A trigger is true right now: ${na.predicateSummary}${na.livePrice != null ? ` (price $${na.livePrice.toFixed(2)})` : ""}`;
    case "FLOOR_TOO_FAR":
      return na.line;
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

/**
 * The flag, in one line: its name, and at most one detail.
 *
 * `needsActionLine` above explains a flag to someone reading an audit. At the
 * top of a stock's page that explanation read as a paragraph of jargon
 * competing with the analyst's own paragraph underneath it, and because every
 * kind carries different fields, every kind said something differently shaped.
 *
 * So: ONE table. The name is the kind, in plain words. The detail is at most
 * one fact that kind actually has — which trigger, how overdue, how stale —
 * and the kinds with nothing worth adding say nothing. No model text ever
 * reaches either half; the flag vocabulary is eight cases and this says which
 * one fired, nothing more.
 *
 * Everything else the flag carries (the other rungs that fired, your own words
 * on a declined sale, where the floor could move to) stays on the object for
 * the agent and for an expanded view. It is not headline material.
 */
export interface NeedsActionFlag {
  /** The kind, in plain words — "Trigger fired", "Review due". */
  name: string;
  /** One fact, or null. Never a sentence. */
  detail: string | null;
}

export function needsActionFlag(na: NeedsAction): NeedsActionFlag {
  switch (na.kind) {
    case "TRIGGER_FIRED":
      return { name: "Trigger fired", detail: na.summary };
    case "TRIGGER_MATCHING_NOW":
      return { name: "Trigger true now", detail: na.predicateSummary };
    case "REVIEW_DUE":
      return {
        name: "Review due",
        detail: na.pendingFirstReview
          ? "never researched"
          : na.daysOverdue > 0
            ? `${na.daysOverdue} day${na.daysOverdue === 1 ? "" : "s"} overdue`
            : null,
      };
    case "RESEARCH_STALE":
      return {
        name: "Research stale",
        detail: na.freshness === "missing" ? "never written" : `${na.daysOld ?? "?"} days old`,
      };
    case "SALE_DECLINED":
      return {
        name: "Sale declined",
        detail:
          na.declineCount > 1
            ? `${na.declineCount}×, last ${na.lastDeclinedAt.slice(0, 10)}`
            : na.lastDeclinedAt.slice(0, 10),
      };
    case "FLOOR_TOO_FAR":
      return {
        name: "Floor too far",
        detail: `${na.pctOfAccount.toFixed(1)}% of the account below here`,
      };
    case "UNPROTECTED_GAIN":
      return {
        name: "Gain unprotected",
        detail:
          `up ${na.unrealizedGainPct.toFixed(0)}%, ` +
          (na.flooredGainPct == null
            ? "no floor under it"
            : `floor locks ${na.flooredGainPct.toFixed(0)}%`),
      };
    case "PROMOTED_AWAITING_RESOLUTION":
      return { name: "Promoted to live money", detail: null };
  }
}
