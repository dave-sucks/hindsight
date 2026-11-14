/**
 * The Agent work tab's vocabulary, safe to import in the browser: the ranges,
 * the six categories with every situation's place in them, what a run can do
 * with a stock, and the run types' names. ./agent-work counts with these.
 */
import type { SituationCode } from "@/lib/agent/situations";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export const CATEGORIES = ["Selling and protection", "Buying and adding", "Events", "Upkeep", "Your word", "Auto"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Every situation's category: the one map to change when codes are cut or merged. */
export const SITUATION_CATEGORY: Record<SituationCode, Category> = {
  PROTECTIVE_SALE: "Selling and protection", PROTECTION: "Selling and protection",
  BUY_ARRIVES: "Buying and adding", BUY_BLOCKED_FULL: "Buying and adding", ADD_OR_WINNER: "Buying and adding",
  EARNINGS: "Events", FILING: "Events",
  REVIEW_DUE: "Upkeep", FIRST_RESEARCH: "Upkeep", QUIET_WATCH_WOKE: "Upkeep",
  SOLD_ONE_REVIEW: "Upkeep", PROMOTED_AWAITING: "Upkeep",
  YOUR_WORD_UNANSWERED: "Your word", PINNED_NOTE: "Your word",
  AUTO_TRADE: "Auto",
};

export const OUTCOMES = ["trade", "refused", "plan", "research", "note", "nothing"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome | "pending", string> = {
  trade: "Proposal or trade", refused: "Trade refused", plan: "Level or trigger change",
  research: "Research rewrite", note: "Note only", nothing: "Nothing", pending: "Not answered yet",
};

export const MODE_LABEL: Record<string, string> = {
  MORNING_PLAN: "Morning", INTRADAY_TACTICAL: "Trigger", THESIS_WRITER: "Writer", PRINCIPAL_CHAT: "Chat",
  PORTFOLIO_DIGEST: "Portfolio Digest", MARKET_REVIEWER: "Market Reviewer",
};
