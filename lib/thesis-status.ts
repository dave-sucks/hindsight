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
 * Safe accessor — returns the ACTIVE display config when the input isn't a
 * known ThesisStatus. Use this everywhere instead of direct
 * `THESIS_STATUS_DISPLAY[x]` indexing. Direct indexing was the source of a
 * production crash ("Cannot read properties of undefined (reading
 * 'dotClass')") that took down every run-detail page when a card was
 * rendered with a missing or unexpected status string. The runtime type
 * is `string | null | undefined`; TypeScript's index-into-Record is too
 * permissive to catch it.
 */
export function getThesisStatusDisplay(
  status: string | null | undefined,
): ThesisStatusDisplay {
  if (status && status in THESIS_STATUS_DISPLAY) {
    return THESIS_STATUS_DISPLAY[status as ThesisStatus];
  }
  return THESIS_STATUS_DISPLAY.ACTIVE;
}

export const THESIS_STATUS_DISPLAY: Record<ThesisStatus, ThesisStatusDisplay> = {
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
    label: "Awaiting live entry",
    // Amber pulse = action required this run. The conviction-pause state
    // after PAPER→LIVE promotion: thesis was held, position force-closed,
    // next live run must place_trade (re-enter) or downgrade to WATCHING.
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
    // Distinct from INVALIDATED (view disproven) and CLOSED (position
    // exited). ARCHIVED = walked away without an evidence-based reason,
    // or PASS at write time. Off the watchlist; visible as institutional
    // memory on the stock detail page.
    dotClass: "bg-muted-foreground/40",
    tooltip: "Walked away — off the watchlist, institutional memory only",
  },
  SUPERSEDED: {
    label: "Superseded",
    dotClass: "bg-muted-foreground/40",
    tooltip: "Replaced by a newer thesis on the same ticker",
  },
};
