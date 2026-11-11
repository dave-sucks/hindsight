/**
 * Run mode catalog — shared between the /runs filter bar (client) and the
 * /runs page server component (for searchParam validation). Lives outside
 * the "use client" file so the server can iterate it at module load.
 */

export const RUNS_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "MORNING_PLAN", label: "Morning" },
  { value: "INTRADAY_TACTICAL", label: "Tactical" },
  { value: "DISCOVERY", label: "Discovery" },
  { value: "THESIS_WRITER", label: "Thesis Research" },
  { value: "PORTFOLIO_REVIEW", label: "Portfolio Reviewer" },
];

/** Runs that work for the account rather than an analyst, by mode: the name a run page and its card show. */
export const ACCOUNT_RUN_NAMES: Record<string, string> = { PORTFOLIO_REVIEW: "Portfolio Reviewer" };

/** Runs that execute on the server: opening one while it runs must not start a second agent on the same run. */
export const SERVER_RUN_MODES: ReadonlySet<string> = new Set(["PORTFOLIO_REVIEW"]);

/**
 * Runs that take no messages: the account's own reviews, which have no analyst.
 * Their page has no composer, and the agent route refuses a message on one,
 * which would otherwise reach the full trade tools on the book.
 */
export const READ_ONLY_RUN_MODES: ReadonlySet<string> = new Set(["PORTFOLIO_REVIEW"]);
