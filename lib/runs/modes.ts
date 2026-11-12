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
  { value: "PORTFOLIO_DIGEST", label: "Portfolio Digest" },
  { value: "MARKET_REVIEWER", label: "Market Reviewer" },
];

/** Runs made for the whole account rather than an analyst, by mode: the name their page and card show. */
export const ACCOUNT_RUN_NAMES: Record<string, string> = { PORTFOLIO_DIGEST: "Portfolio Digest", MARKET_REVIEWER: "Market Reviewer" };

/**
 * Runs that take no messages. They run on the server and have no analyst, so
 * their page starts no agent and has no composer, and the agent route refuses
 * a message on one: it would reach the full trade tools on the book.
 */
export const READ_ONLY_RUN_MODES: ReadonlySet<string> = new Set(["PORTFOLIO_DIGEST", "MARKET_REVIEWER"]);
