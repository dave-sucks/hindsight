/**
 * Shared display config for Thesis.status — one source of truth for the
 * pill that appears on read-theses rows, the carousel mini-card, the
 * thesis card header, and the sheet header. All four surfaces render
 * the same neutral Badge with a status-colored dot.
 *
 * Mirrors lib/trade-status.ts.
 */

export type ThesisStatus =
  | "ACTIVE"
  | "WATCHING"
  | "PROMOTED"
  | "CLOSED"
  | "INVALIDATED"
  | "ARCHIVED"
  | "SUPERSEDED";

export interface ThesisStatusDisplay {
  label: string;
  /** Tailwind class for the colored dot. */
  dotClass: string;
  /** Tooltip text shown on hover. */
  tooltip: string;
}

/**
 * Display-only pseudo-status. "Pass" is stored on `Thesis.direction`
 * (`direction === "PASS"`), not on `status` — a passed thesis lands
 * `status: "ARCHIVED"`. But ARCHIVED is also used for non-PASS walk-aways
 * (manual remove, editor cleanup), so we can't rename ARCHIVED → "Passed"
 * wholesale. `PASSED` is the display key the accessor returns when it sees
 * a PASS direction, while plain ARCHIVED keeps its "Walked away" copy.
 * See docs/GAPS.md P1-24 + docs/THESIS_ARCHITECTURE.md §3a.
 */
type ThesisStatusDisplayKey = ThesisStatus | "PASSED";

/**
 * Safe accessor — returns the ACTIVE display config when the input isn't a
 * known ThesisStatus. Use this everywhere instead of direct
 * `THESIS_STATUS_DISPLAY[x]` indexing. Direct indexing was the source of a
 * production crash ("Cannot read properties of undefined (reading
 * 'dotClass')") that took down every run-detail page when a card was
 * rendered with a missing or unexpected status string. The runtime type
 * is `string | null | undefined`; TypeScript's index-into-Record is too
 * permissive to catch it.
 *
 * When `direction === "PASS"`, the thesis is "Researched and declined"
 * regardless of its (always-ARCHIVED) status — return the PASSED display.
 * The optional `direction` param keeps the status-only signature working
 * for callers that don't have direction in scope.
 */
export function getThesisStatusDisplay(
  status: string | null | undefined,
  direction?: string | null,
): ThesisStatusDisplay {
  if (direction === "PASS") {
    return THESIS_STATUS_DISPLAY.PASSED;
  }
  if (status && status in THESIS_STATUS_DISPLAY) {
    return THESIS_STATUS_DISPLAY[status as ThesisStatusDisplayKey];
  }
  return THESIS_STATUS_DISPLAY.ACTIVE;
}

export const THESIS_STATUS_DISPLAY: Record<
  ThesisStatusDisplayKey,
  ThesisStatusDisplay
> = {
  ACTIVE: {
    label: "Active",
    // 2026-05-13 — relabel from "Holding" to "Active".
    //
    // PRIOR BUG: ACTIVE meant "Holding" with a pulsing blue dot, on the
    // mistaken assumption that ACTIVE always coincides with an open
    // position. It does not — ACTIVE = "trade-eligible coverage" per the
    // record_thesis schema, which is independent of whether a Position
    // row exists. Plenty of ACTIVE theses sit with no position because
    // the agent decided not to trade them today, the ENTER trigger
    // hasn't fired, or place_trade is deferred to the next daily run.
    // Showing "Holding" actively lied to the user (see the 2026-05-13
    // INTC discovery run UI where two cards both said "Holding" despite
    // zero open positions in the DB).
    //
    // The label tracks thesis lifecycle. Position state is rendered
    // separately on TradeCard / portfolio-review surfaces.
    dotClass: "bg-blue-500 animate-pulse",
    tooltip: "Trade-eligible coverage — agent intends to act on this thesis",
  },
  WATCHING: {
    label: "Watching",
    // Gray = passive monitoring. Distinct from blue (live) and from the
    // terminal grays used by Closed/Superseded — slightly brighter to
    // signal "still being watched, not archived."
    dotClass: "bg-muted-foreground",
    tooltip: "On the watchlist — promotion triggers govern entry",
  },
  PROMOTED: {
    label: "Promoted",
    // Amber pulse = action required this run. The conviction-pause state
    // after PAPER→LIVE promotion: thesis was held, position force-closed,
    // next live run must place_trade (re-enter) or downgrade to WATCHING.
    // Label is the literal enum name; the prior "Awaiting live entry" read
    // as passive informational copy and the daily-run agent skipped these
    // rows on the 2026-05-26 first-live morning run.
    dotClass: "bg-amber-500 animate-pulse",
    tooltip:
      "Held in paper, just promoted to live — next run must re-enter or downgrade to watching",
  },
  CLOSED: {
    label: "Closed",
    dotClass: "bg-muted-foreground/60",
    tooltip: "Position exited — thesis terminal",
  },
  INVALIDATED: {
    label: "Invalidated",
    dotClass: "bg-negative",
    tooltip: "Thesis broken — exited or never entered",
  },
  ARCHIVED: {
    label: "Archived",
    // Walked away from the watchlist without an evidence-driven view-break
    // (manual remove, editor remove, PASS-at-write). Visually distinct from
    // INVALIDATED (which carries narrative weight) and CLOSED (which
    // implies a position lifecycle).
    dotClass: "bg-muted-foreground/40",
    tooltip:
      "Walked away from coverage — no trade outcome, no evidence-driven invalidation",
  },
  PASSED: {
    label: "Passed",
    // Display-only pseudo-status for direction === "PASS" theses (which are
    // always status: ARCHIVED). Same gray dot as ARCHIVED — both are
    // terminal-without-trade — but distinct copy: a PASS is "researched and
    // declined" institutional memory, not a generic walk-away.
    dotClass: "bg-muted-foreground/40",
    tooltip: "Researched and declined — institutional memory",
  },
  SUPERSEDED: {
    label: "Superseded",
    dotClass: "bg-muted-foreground/40",
    tooltip: "Replaced by a newer thesis on the same ticker",
  },
};
