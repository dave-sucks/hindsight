/**
 * What an agent can be given (docs/plans/AGENT_ENGINE.md), client-safe: the
 * facts that make up its context, and the one line every first message opens
 * with. Each says what it holds and the file
 * its text comes from. The engine (./engine.ts) puts them together.
 */
import type { ContextId } from "./types";

export interface PartDef {
  title: string;
  /** What it holds, in a line. */
  about: string;
  /** The file its text comes from. */
  source: string;
}

/** The facts a record may send with an agent's instructions, where they were measured: the analyst, the playbooks, the stock's situations. */
const PLACED_IN_INSTRUCTIONS: Record<"the_analyst" | "playbooks" | "the_playbook" | "situations", PartDef> = {
  the_analyst: {
    title: "The analyst",
    about: "The analyst it works for: its strategy in its own words, its rules (direction, hold style, size, slots, and the stocks it may cover where its fence narrows them) and its playbooks, a line each.",
    source: "lib/agent/analyst-brief.ts",
  },
  playbooks: {
    title: "The playbooks",
    about: "Each of the analyst's playbooks in full: when it applies, what confirms a buy, and its watch triggers. The Writer picks a stock's playbook from them.",
    source: "lib/agent/knowledge/playbooks.ts (Settings → Playbooks)",
  },
  the_playbook: {
    title: "The stock's playbook",
    about: "The playbook the stock is on, in full: when it applies, what confirms a buy, and its watch triggers; each of its analyst's when it has none yet.",
    source: "lib/agent/knowledge/playbooks.ts (Settings → Playbooks)",
  },
  situations: {
    title: "The stock's situations",
    about: "The situations the stock is in now, and what each asks, from the one table.",
    source: "lib/agent/situations.ts",
  },
};

/** The line every first message opens with. */
export const DATE_LINE: PartDef = {
  title: "The date and account",
  about: "The date and time in New York, and whether the account is paper or live. Every first message opens with it.",
  source: "lib/agent/engine/engine.ts (dateLine)",
};

export interface ContextDef extends PartDef {
  /** Printed under the group's heading, once, before the first of the group's reads an agent gets. */
  group?: "market_and_portfolio";
}

export const GROUP_HEADINGS = { market_and_portfolio: "## Market and portfolio" } as const;

/** Every fact an agent can be given, in its instructions or its first message. */
export const CONTEXT: Record<ContextId, ContextDef> = {
  ...PLACED_IN_INSTRUCTIONS,
  market_numbers: {
    title: "Market numbers",
    about: "The S&P 500 and Nasdaq 100, the regime, the 11 sectors, VIXY and our stocks reporting soon, written by code for the request.",
    source: "lib/market-data/market-numbers.ts",
    group: "market_and_portfolio",
  },
  market_digest: {
    title: "Market digest",
    about: "The 7:30 AM Market Reviewer's write-up of the market's day, if it is from the last 4 days.",
    source: "lib/agent/market-reviewer (the MarketDigest row)",
    group: "market_and_portfolio",
  },
  portfolio: {
    title: "The portfolio",
    about: "Today's snapshot of the account: value, cash, every holding and how it moved, the day's buys and sells, and the proposals waiting for you.",
    source: "lib/portfolio/snapshot.ts",
    group: "market_and_portfolio",
  },
  portfolio_digest: {
    title: "Portfolio digest",
    about: "The latest 8 PM summary of the account written for you, if it is from the last 4 days.",
    source: "lib/agent/digest-writer.ts (the PortfolioDigest row)",
    group: "market_and_portfolio",
  },
  the_book: {
    title: "The book",
    about: "Every stock we hold and every stock we watch, a line each with its belief; a watch also with its buy triggers.",
    source: "lib/agent/book.ts",
  },
  the_cases: {
    title: "What each thesis rests on",
    about: "For every stock we hold or watch: its assumptions and what would prove it wrong, as its thesis has them.",
    source: "lib/agent/book.ts (loadCases)",
  },
  the_analysts: {
    title: "The analysts",
    about: "Each analyst's room: its slots against its limit, its largest trade and the most in one stock.",
    source: "lib/agent/analyst-scope.ts (analystRoomLines)",
  },
  the_stock: {
    title: "The stock",
    about: "The stock as every run reads it (get_theses): the belief, its triggers with ids, the position, the last notes, the chart and the Street, and what its playbook checks before a buy.",
    source: "lib/agent/row-for-model.ts (stockFromRead)",
  },
  holding_triggers: {
    title: "The playbook's holding triggers",
    about: "The stock's playbook's triggers for a holding, by reference (H1, H2…): those that come with the buy, then those written at the fill, each with its reason and where each chart key's number comes from.",
    source: "lib/agent/knowledge/playbooks.ts (playbookTriggerText)",
  },
  stock_data: {
    title: "The stock's data",
    about: "Price and chart levels, financials, earnings history, the Street's view, insiders, peers, filings, headlines, and our history with the stock.",
    source: "lib/agent/thesis-research/format-data-block.ts",
  },
  playbook_record: {
    title: "Record by playbook",
    about: "This analyst's closed trades, a line per playbook: trades, win rate, R, days held, give-back.",
    source: "lib/agent/run-thesis-writer.ts (loadScorecardLines)",
  },
  earnings_this_week: {
    title: "Earnings this week",
    about: "The book's stocks reporting in the next 7 days, and those that reported in the last 3 with their numbers.",
    source: "lib/agent/run-input.ts (the earnings calendar)",
  },
  filings_this_week: {
    title: "Filings this week",
    about: "Serious and material filings on the book in the last 7 days, from EDGAR.",
    source: "lib/agent/run-input.ts (filingsOnBook)",
  },
  earnings_calendar: {
    title: "The earnings calendar",
    about: "Who reported in the last 7 days and who reports in the next 14, outside the analyst's book, as get_earnings_calendar reads it.",
    source: "lib/agent/discovery/run.ts (earningsCalendar)",
  },
  refused_calls: {
    title: "Refused calls",
    about: "This analyst's refused calls from the last 7 days that no run has redone yet.",
    source: "lib/agent/refusal-carryover.ts",
  },
  last_output: {
    title: "Its last output",
    about: "What the agent wrote on its last run: the Portfolio Manager's write-up; the Market Reviewer's digest and its notes of the last 5 days.",
    source: "lib/agent/portfolio-manager/run.ts, lib/agent/market-reviewer/run.ts",
  },
};
