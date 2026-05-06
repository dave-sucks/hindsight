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
  | "CLOSED"
  | "INVALIDATED"
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
    label: "Holding",
    // Blue pulse = live/open position. Mirrors TRADE_STATUS_DISPLAY.OPEN
    // so a held thesis and an open trade read identically.
    dotClass: "bg-blue-500 animate-pulse",
    tooltip: "Open position — thesis is active in the book",
  },
  WATCHING: {
    label: "Watching",
    // Gray = passive monitoring. Distinct from blue (live) and from the
    // terminal grays used by Closed/Superseded — slightly brighter to
    // signal "still being watched, not archived."
    dotClass: "bg-muted-foreground",
    tooltip: "On the watchlist — promotion triggers govern entry",
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
  SUPERSEDED: {
    label: "Superseded",
    dotClass: "bg-muted-foreground/40",
    tooltip: "Replaced by a newer thesis on the same ticker",
  },
};
