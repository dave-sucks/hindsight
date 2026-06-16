/**
 * Shared display config for Thesis.status — one source of truth for the
 * pill that appears on read-theses rows, the carousel mini-card, the
 * thesis card header, and the sheet header. All four surfaces render
 * the same neutral Badge with a status-colored dot.
 *
 * Mirrors lib/trade-status.ts.
 */

// P1-24 clean model. The legacy values (ACTIVE / CLOSED / INVALIDATED /
// ARCHIVED / SUPERSEDED) were removed in the contract PR — nothing reads or
// writes them anymore; the DB enum drops them in the paired schema migration.
export type ThesisStatus =
  | "WATCHING"
  | "PROMOTED"
  | "HOLDING"
  | "PASSED"
  | "RETIRED";

export interface ThesisStatusDisplay {
  label: string;
  /** Tailwind class for the colored dot. */
  dotClass: string;
  /** Tooltip text shown on hover. */
  tooltip: string;
}

/**
 * Safe accessor — returns a neutral "Unknown" display when the input isn't a
 * known ThesisStatus. Use this everywhere instead of direct
 * `THESIS_STATUS_DISPLAY[x]` indexing. Direct indexing was the source of a
 * production crash ("Cannot read properties of undefined (reading
 * 'dotClass')") that took down every run-detail page when a card was
 * rendered with a missing or unexpected status string. The runtime type
 * is `string | null | undefined`; TypeScript's index-into-Record is too
 * permissive to catch it.
 *
 * P1-24: the fallback used to return the ACTIVE display. ACTIVE no longer
 * exists, and silently labeling an unknown status "Active" (blue pulse =
 * holding) was a lie. A genuinely-unknown status now renders a neutral gray
 * "Unknown" pill instead.
 */
export function getThesisStatusDisplay(
  status: string | null | undefined,
): ThesisStatusDisplay {
  if (status && status in THESIS_STATUS_DISPLAY) {
    return THESIS_STATUS_DISPLAY[status as ThesisStatus];
  }
  return UNKNOWN_THESIS_STATUS_DISPLAY;
}

const UNKNOWN_THESIS_STATUS_DISPLAY: ThesisStatusDisplay = {
  label: "Unknown",
  dotClass: "bg-muted-foreground/40",
  tooltip: "Unrecognized status",
};

export const THESIS_STATUS_DISPLAY: Record<ThesisStatus, ThesisStatusDisplay> = {
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
  HOLDING: {
    label: "Holding",
    // Unlike the old ACTIVE, HOLDING never lies: it means an open position
    // backs this thesis (execution-owned). Blue pulse = live holding.
    dotClass: "bg-blue-500 animate-pulse",
    tooltip: "Holding an open position",
  },
  PASSED: {
    label: "Passed",
    dotClass: "bg-muted-foreground/40",
    tooltip: "Researched and declined — institutional memory",
  },
  RETIRED: {
    label: "Retired",
    dotClass: "bg-muted-foreground/60",
    tooltip: "No longer tracked — dropped, sold, or invalidated",
  },
};
