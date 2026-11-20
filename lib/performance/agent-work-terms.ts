/**
 * The Agent work tab's vocabulary, safe to import in the browser: the ranges,
 * the four categories with every situation's place in them, what a run can do
 * with a stock, and the run types' names. ./agent-work counts with these.
 */
import type { SituationCode } from "@/lib/agent/situations";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export const CATEGORIES = ["Selling and protection", "Buying and adding", "Upkeep", "Your word"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Every situation's category: the one map to change when codes are cut or merged. */
export const SITUATION_CATEGORY: Record<SituationCode, Category> = {
  PROTECTIVE_SALE: "Selling and protection", PROTECTION: "Selling and protection",
  BUY_ARRIVES: "Buying and adding", ADD_OR_WINNER: "Buying and adding",
  REVIEW_DUE: "Upkeep", REPORT: "Upkeep", FILING: "Upkeep", NEWS: "Upkeep", SOLD_ONE_REVIEW: "Upkeep", PROMOTED_AWAITING: "Upkeep",
  NOTE_TO_ANSWER: "Your word",
};

/** A code saved by a morning read before situations were merged (2026-11-15), as the one it is now; a report and a filing are their own again (2026-11-19). */
export const MERGED_CODE: Readonly<Record<string, SituationCode>> = {
  BUY_BLOCKED_FULL: "BUY_ARRIVES",
  EARNINGS: "REPORT", QUIET_WATCH_WOKE: "REVIEW_DUE", FIRST_RESEARCH: "REVIEW_DUE",
  YOUR_WORD_UNANSWERED: "NOTE_TO_ANSWER", PINNED_NOTE: "NOTE_TO_ANSWER",
};

export const OUTCOMES = ["trade", "refused", "plan", "research", "note", "nothing"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome | "pending", string> = {
  trade: "Proposal or trade", refused: "Trade refused", plan: "Level or trigger change",
  research: "Research rewrite", note: "Note only", nothing: "Nothing", pending: "Not answered yet",
};

export const MODE_LABEL: Record<string, string> = {
  MORNING_PLAN: "Morning", INTRADAY_TACTICAL: "Trigger", THESIS_WRITER: "Writer", PRINCIPAL_CHAT: "Chat",
  PORTFOLIO_DIGEST: "Portfolio Digest", MARKET_REVIEWER: "Market Reviewer", AFTER_BUY: "After the buy",
};
