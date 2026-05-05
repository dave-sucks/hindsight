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

export const THESIS_STATUS_DISPLAY: Record<ThesisStatus, ThesisStatusDisplay> = {
  ACTIVE: {
    label: "Holding",
    // Same dotClass as TRADE_STATUS_DISPLAY.OPEN so a held thesis and
    // an open trade read identically. Single source of "this is a live
    // holding" visual across the app.
    dotClass: "bg-positive animate-pulse",
    tooltip: "Open position — thesis is active in the book",
  },
  WATCHING: {
    label: "Watching",
    dotClass: "bg-blue-500",
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
