/**
 * What each agent is sent, part by part: the one list behind the chips on
 * the workflow diagram (/how-it-works) and the list on the agent's own doc
 * (`<!-- asset: context <slug> -->`), so the two can't disagree. Each part
 * takes the Framework page's color (components/docs/framework/swatch.ts).
 * Read off the code that builds each request: the four prompts
 * (lib/agent/system-prompt.ts, system-prompts/intraday-tactical.ts,
 * buildPrincipalSystemPrompt in modes.ts, run-thesis-writer.ts), the Market
 * and portfolio block (portfolio-block.ts), the Market Reviewer's first
 * message (market-reviewer/run.ts) and the Portfolio Digest's
 * (digest-writer.ts). agent-context.test.ts pins the prompt-built ones.
 * Client-safe. Ordered as the card shows them: the first three are drawn.
 */

import type { PartId } from "@/components/docs/framework/swatch";

export interface ContextPart {
  label: string;
  part: PartId;
  about: string;
}

export type ContextAgent = "discovery" | "writer" | "morning-runs" | "trigger-runs" | "chat" | "market-reviewer" | "portfolio-digest";

const p = (label: string, part: PartId, about: string): ContextPart => ({ label, part, about });

// The Market and portfolio block's four parts. The two digests are what the 7:30 and 8 PM agents write.
export const MARKET_NUMBERS = p("Market numbers", "portfolio", "The indexes, the regime, the 11 sectors, VIXY and our stocks reporting in the next 14 days, written by code.");
export const MARKET_DIGEST = p("Market digest", "portfolio", "The Market Reviewer's latest 7:30 digest, stamped with when it was written.");
export const PORTFOLIO_SNAPSHOT = p("Portfolio snapshot", "portfolio", "The account's value and cash, every holding and how it moved, the day's fills, the proposals waiting. Written by code.");
export const PORTFOLIO_DIGEST = p("Portfolio digest", "portfolio", "The Portfolio Digest's latest 8 PM write-up, stamped with when it was written.");

const INSTRUCTIONS = (job: string) => p("Instructions", "job", job);
const HOUSE = p("House rules", "house", "What is true for every analyst: your word first, and how to write.");
const ANALYST = p("Analyst brief", "analyst", "Your strategy, word for word, its rules on direction and size, its setups and how many slots are free.");
const TOOLS = (n: string) => p("Tool menu", "tools", n);
const GUIDANCE = p("Situation guidance", "guidance", "The instructions for each situation on today's list, once each.");

const CHAT: ContextPart[] = [
  p("Stocks by name", "named", "A stock's full row, asked for when the conversation needs it."),
  MARKET_DIGEST,
  PORTFOLIO_DIGEST,
  INSTRUCTIONS("Answer you, look things up, and act only when you say so."),
  HOUSE,
  p("Analyst brief", "analyst", "When the chat is opened on an analyst: its strategy, rules, setups and slots."),
  MARKET_NUMBERS,
  PORTFOLIO_SNAPSHOT,
  TOOLS("Every research tool, the trade tools, notes, and sending a stock to the Writer."),
];

export const AGENT_CONTEXT: Record<ContextAgent, readonly ContextPart[]> = {
  // Discovery is a job the chat does, so it is sent the chat's request.
  discovery: CHAT,
  chat: CHAT,
  writer: [
    p("Its data pull", "read", "The stock's data, pulled by code before it writes: price and chart, earnings, filings, the Street, our history with it."),
    p("What the chat found", "named", "When a chat sent the stock: what that chat's web searches turned up."),
    ANALYST,
    INSTRUCTIONS("Research one stock in depth and write its whole thesis, plan and all."),
    HOUSE,
    MARKET_NUMBERS,
    MARKET_DIGEST,
    PORTFOLIO_SNAPSHOT,
    PORTFOLIO_DIGEST,
    TOOLS("Web search, and the thesis it submits."),
  ],
  "morning-runs": [
    p("The read", "read", "The whole book: a quiet stock in a line, a stock in a situation as a row with what its decision needs."),
    MARKET_DIGEST,
    PORTFOLIO_DIGEST,
    GUIDANCE,
    ANALYST,
    INSTRUCTIONS("Walk the whole book and act where something changed."),
    HOUSE,
    MARKET_NUMBERS,
    PORTFOLIO_SNAPSHOT,
    TOOLS("Research, the stock's plan, trades, and sending a stock to the Writer."),
  ],
  "trigger-runs": [
    p("The fire and its stock", "read", "The trigger that fired, beside the stock's row and its newest 8 Activity lines."),
    MARKET_DIGEST,
    PORTFOLIO_DIGEST,
    GUIDANCE,
    ANALYST,
    INSTRUCTIONS("One stock, one decision: sell, buy, add, or say why not."),
    HOUSE,
    MARKET_NUMBERS,
    PORTFOLIO_SNAPSHOT,
    TOOLS("Research, the stock's plan, trades, and sending a stock to the Writer."),
  ],
  "market-reviewer": [
    INSTRUCTIONS("Research the market on the web and write the digest, plus a note on each stock its research touched."),
    MARKET_NUMBERS,
    PORTFOLIO_SNAPSHOT,
    p("Our stocks", "read", "Every stock held or watched, with its belief in a line."),
    p("Its notes, 5 days", "read", "Its own notes of the last 5 days, a line each, so it doesn't file the same story twice."),
    p("Its last digest", "portfolio", "The market digest it wrote last, so it says what changed."),
    TOOLS("OpenAI's own web search, inside its one call."),
  ],
  "portfolio-digest": [INSTRUCTIONS("Write the account's day in 3 to 5 short paragraphs, from the numbers only."), PORTFOLIO_SNAPSHOT],
};

/** How many parts an agent's card draws before its "+N". */
export const CHIPS_SHOWN = 3;
