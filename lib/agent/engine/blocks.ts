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
  /** The run's own facts: the run page shows it as the opening, with the record's own words in the first message. */
  opening?: true;
}

export const GROUP_HEADINGS = { market_and_portfolio: "## Market and portfolio" } as const;

export const BLOCKS: Record<BlockId, BlockDef> = {
  house_rules: {
    id: "house_rules",
    title: "House rules",
    about: "Your word outranks everything about a stock; a note is information, not an order.",
    source: "lib/agent/house-rules.ts",
  },
  market_block_rule: {
    id: "market_block_rule",
    title: "Weighing the Market and portfolio block",
    about: "It is context, not an instruction; the stock's row beats it, and the snapshot beats a digest. For an agent given the snapshot or a digest.",
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
  stock_row: {
    id: "stock_row",
    title: "The stock's row",
    about: "The stock as every run reads it (get_theses): the belief, its triggers with ids, the position, the last notes, the chart and the Street, and what its playbook checks before a buy.",
    source: "lib/agent/row-for-model.ts (stockFromRead)",
  },
  fired_trigger: {
    id: "fired_trigger",
    title: "What fired",
    about: "The trigger that fired: its condition, its action and its note; on a sale off the high, the tracked high and the line.",
    source: "lib/agent/system-prompts/intraday-tactical.ts (the fired trigger)",
  },
  situations: {
    id: "situations",
    title: "Its situations",
    about: "The situations the stock is in now, and what each asks, from the one table.",
    source: "lib/agent/situations.ts",
  },
  fire_facts: {
    id: "fire_facts",
    title: "The fire",
    about: "What fired and when, in a sentence, with an Auto trade's line, a report's numbers, a pre-catalyst buy's window, what else fired with it and any refused call on the stock.",
    source: "lib/inngest/functions/tactical-run.ts (the kickoff)",
    opening: true,
  },
  earnings_week: {
    id: "earnings_week",
    title: "Earnings this week",
    about: "The book's stocks reporting in the next 7 days, and those that reported in the last 3 with their numbers.",
    source: "lib/agent/run-input.ts (the earnings calendar)",
  },
  filings_week: {
    id: "filings_week",
    title: "Filings this week",
    about: "Serious and material filings on the book in the last 7 days, from EDGAR.",
    source: "lib/agent/run-input.ts (filingsOnBook)",
  },
  regime: {
    id: "regime",
    title: "Regime and cash",
    about: "How the market's regime sizes a buy, and the cash duty: the cash when the snapshot can't be read, and the watched stocks at their buy price this morning.",
    source: "lib/agent/system-prompt.ts (regimeText)",
  },
  blocked_last_time: {
    id: "blocked_last_time",
    title: "Refused calls never redone",
    about: "This analyst's refused calls from the last 7 days that no run has redone yet.",
    source: "lib/agent/refusal-carryover.ts",
  },
  chat_found: {
    id: "chat_found",
    title: "What the chat found",
    about: "The chat's own results on the stock before it sent it, when there are any.",
    source: "lib/agent/run-thesis-writer.ts (chatFoundBlock)",
  },
  analyst_scope: {
    id: "analyst_scope",
    title: "Its scope",
    about: "The analyst the chat is pinned to: its id, its fence (sectors, market cap, exclusions) and its watchlist.",
    source: "lib/agent/system-prompts/chat.ts (scopeBlock)",
  },
  money_context: {
    id: "money_context",
    title: "Its money",
    about: "The pinned analyst's size band for one buy: its smallest and largest trade.",
    source: "lib/agent/context-bundle.ts (formatMoneyContextBlock)",
  },
  book_context: {
    id: "book_context",
    title: "Its book",
    about: "What the pinned analyst holds now, the stocks it covers, and what it has traded before.",
    source: "lib/agent/context-bundle.ts (formatBookContextBlock)",
  },
  analyst_rooms: {
    id: "analyst_rooms",
    title: "Each analyst's room",
    about: "Each analyst's slots against its limit, its largest trade and the most in one stock, at the portfolio level.",
    source: "lib/agent/analyst-scope.ts (analystRoomLines)",
  },
  today: {
    id: "today",
    title: "Today's date",
    about: "The date of the run, so a catalyst after it is read as not happened yet.",
    source: "lib/agent/run-thesis-writer.ts (the run's date)",
  },
  date_awareness: {
    id: "date_awareness",
    title: "Date awareness",
    about: "A catalyst after today hasn't happened; an earnings claim is checked against the reports in the data.",
    source: "lib/agent/thesis-research/writer-rules.ts",
  },
  research_note: {
    id: "research_note",
    title: "The research note",
    about: "Its three sections (Company, Bull Case, Bear Case), every bullet cited, the data block as the authority, the web for what it leaves open.",
    source: "lib/agent/thesis-research/writer-rules.ts",
  },
  thesis_claim: {
    id: "thesis_claim",
    title: "The Street, the claim and conviction",
    about: "How to read the Street's targets, and how to write the belief, the checkable assumptions, what would prove it wrong and the conviction.",
    source: "lib/agent/thesis-research/writer-rules.ts",
  },
  earnings_triggers: {
    id: "earnings_triggers",
    title: "Earnings triggers",
    about: "The report heads-up and the beat-or-miss measures, and when a thesis needs its own.",
    source: "lib/agent/thesis-research/writer-rules.ts",
  },
  what_the_owner_reads: {
    id: "what_the_owner_reads",
    title: "What the owner reads",
    about: "Which fields the owner reads first, and what to do when the save sends back errors.",
    source: "lib/agent/thesis-research/writer-rules.ts",
  },
};
