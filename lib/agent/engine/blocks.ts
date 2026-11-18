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
};
