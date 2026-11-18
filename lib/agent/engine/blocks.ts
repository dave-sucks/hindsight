/**
 * The library of context blocks an agent can be given (docs/plans/AGENT_ENGINE.md).
 * Client-safe: what each block is and where its text comes from. The engine
 * (./engine.ts) loads the text.
 *
 * A block in a group prints under the group's heading, once, before the first
 * of the group's blocks the agent gets.
 */
import type { BlockId } from "./types";

export interface BlockDef {
  id: BlockId;
  title: string;
  /** What it holds, in a line. */
  about: string;
  /** The file its text comes from. */
  source: string;
  group?: "market_and_portfolio";
}

export const GROUP_HEADINGS = { market_and_portfolio: "## Market and portfolio" } as const;

export const BLOCKS: Record<BlockId, BlockDef> = {
  house_rules: {
    id: "house_rules",
    title: "House rules",
    about: "Your word outranks everything about a stock; a note is information, not an order; how to weigh the Market and portfolio block.",
    source: "lib/agent/house-rules.ts",
  },
  how_you_write: {
    id: "how_you_write",
    title: "How you write",
    about: "How a note, a trade's reason, a trigger's note and the narration are written.",
    source: "lib/agent/voice.ts",
  },
  market_numbers: {
    id: "market_numbers",
    title: "Market numbers",
    about: "The S&P 500 and Nasdaq 100, the regime, the 11 sectors, VIXY and our stocks reporting soon, written by code for the request.",
    source: "lib/market-data/market-numbers.ts",
    group: "market_and_portfolio",
  },
  market_digest: {
    id: "market_digest",
    title: "Market digest",
    about: "The 7:30 AM Market Reviewer's write-up of the market's day, if it is from the last 4 days.",
    source: "lib/agent/market-reviewer (the MarketDigest row)",
    group: "market_and_portfolio",
  },
  portfolio_snapshot: {
    id: "portfolio_snapshot",
    title: "Portfolio snapshot",
    about: "The account: value, cash, every holding and how it moved, the day's buys and sells, and the proposals waiting for you.",
    source: "lib/portfolio/snapshot.ts",
    group: "market_and_portfolio",
  },
  watching: {
    id: "watching",
    title: "Watching",
    about: "Every stock we watch, a line each: its moves, conviction, buy trigger and belief.",
    source: "lib/portfolio/snapshot.ts",
    group: "market_and_portfolio",
  },
  portfolio_digest: {
    id: "portfolio_digest",
    title: "Portfolio digest",
    about: "The latest 8 PM summary of the account written for you, if it is from the last 4 days.",
    source: "lib/agent/digest-writer.ts (the PortfolioDigest row)",
    group: "market_and_portfolio",
  },
  last_writeup: {
    id: "last_writeup",
    title: "Its last write-up",
    about: "The Portfolio Manager's own write-up from its last run.",
    source: "lib/agent/portfolio-manager/run.ts (the portfolio_writeup RunEvent)",
  },
  held_beliefs: {
    id: "held_beliefs",
    title: "Why we hold each",
    about: "Every stock we own with the first sentence of its belief, a line each.",
    source: "lib/agent/market-reviewer/run.ts (the theses we hold)",
  },
  watched_beliefs: {
    id: "watched_beliefs",
    title: "What we watch, and why",
    about: "Every stock we watch with the first sentence of its belief, a line each.",
    source: "lib/agent/market-reviewer/run.ts (the theses we watch)",
  },
  reviewer_notes: {
    id: "reviewer_notes",
    title: "Its notes, last 5 days",
    about: "The notes the Market Reviewer wrote on our stocks in the last 5 days, a line each.",
    source: "lib/agent/market-reviewer/run.ts (its SharedNote rows)",
  },
  last_digest: {
    id: "last_digest",
    title: "Its last digest",
    about: "The Market Reviewer's own digest from its last run.",
    source: "lib/agent/market-reviewer/run.ts (the MarketDigest row)",
  },
  analyst_brief: {
    id: "analyst_brief",
    title: "The analyst",
    about: "The analyst's own strategy text, its rules (direction, size band, slots) and its playbooks in a line each.",
    source: "lib/agent/analyst-brief.ts",
  },
  playbooks: {
    id: "playbooks",
    title: "Its playbooks",
    about: "Each of the analyst's playbooks in full: when it applies, what confirms a buy, and its watch triggers.",
    source: "lib/agent/knowledge/playbooks.ts (Settings → Playbooks)",
  },
  why_sent: {
    id: "why_sent",
    title: "Why it was sent",
    about: "The reason the stock was sent to research, as the sender wrote it.",
    source: "dispatch_thesis_research (its reason)",
  },
  sender_notes: {
    id: "sender_notes",
    title: "What the sender found",
    about: "The sender's own reads before it sent the stock, when it sent any.",
    source: "dispatch_thesis_research (its research notes)",
  },
  idea_source: {
    id: "idea_source",
    title: "Whose idea it was",
    about: "Someone else's thesis the stock came from, as data to test, when there is one.",
    source: "dispatch_thesis_research (its idea source)",
  },
  existing_thesis: {
    id: "existing_thesis",
    title: "The thesis now",
    about: "On a refresh: the stock's status, direction, belief and triggers with their ids.",
    source: "lib/agent/run-thesis-writer.ts (the Thesis row)",
  },
  promotion: {
    id: "promotion",
    title: "Paper history",
    about: "On a promotion to live money: how the paper position did.",
    source: "lib/agent/run-thesis-writer.ts (the promotion)",
  },
  setup_record: {
    id: "setup_record",
    title: "Its record by playbook",
    about: "This analyst's closed trades, a line per playbook: trades, win rate, R, days held, give-back.",
    source: "lib/agent/run-thesis-writer.ts (loadScorecardLines)",
  },
  prior_exit: {
    id: "prior_exit",
    title: "A recent sale",
    about: "When this analyst sold the stock in the last 14 days: the price and the reason.",
    source: "lib/agent/run-thesis-writer.ts (the sold thesis)",
  },
  stock_data: {
    id: "stock_data",
    title: "The stock's data",
    about: "Price and chart levels, financials, earnings history, the Street's view, insiders, peers, filings and headlines.",
    source: "lib/agent/thesis-research/format-data-block.ts",
  },
  chat_found: {
    id: "chat_found",
    title: "What the chat found",
    about: "The chat's own results on the stock before it sent it, when there are any.",
    source: "lib/agent/run-thesis-writer.ts (chatFoundBlock)",
  },
};
