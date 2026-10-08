/**
 * needs-action-line.ts — the work-list flag in words, for a person (DAV-304).
 * The thesis sheet's flag line and the run's read-theses table both say it
 * with `needsActionFlag`, so a stock's flag reads the same everywhere.
 *
 * Its own file, not a function on needs-action.ts: that module reaches
 * `node:crypto` through the trigger evaluator, so a client component can only
 * import the TYPE from it. Type imports are erased; this one is real code.
 */
import type { NeedsAction } from "@/lib/agent/needs-action";

/**
 * The flag, in one line: its name, and at most one detail.
 *
 * A full sentence per kind read as a paragraph of jargon competing with the
 * analyst's own paragraph underneath it, and because every kind carries
 * different fields, every kind said something differently shaped.
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
