/**
 * What rides on the chat's newest message, in each shape it takes: the time
 * with the market open and closed, the Market and portfolio block whole, the
 * block unreadable, and no block. The test checks the engine's newest message
 * against what the route made from the same cases before the move
 * (./chat-newest.golden.json).
 */
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";

const PIECES: PortfolioPiece[] = [
  { id: "market_numbers", text: "### Market numbers (as of Wed, Nov 4, 1:30 PM ET)\nS&P 500 6,800, up 0.4% today." },
  { id: "market_digest", text: "### Market digest (written Wed, Nov 4, 7:30 AM ET)\nStocks opened higher after the jobs report." },
  { id: "portfolio_snapshot", text: "### Portfolio snapshot\nValue $100,000 · cash $20,000." },
  { id: "portfolio_digest", text: "### Portfolio digest (written Tue, Nov 3, 8:00 PM ET)\nThe book held up." },
];

export const CHAT_NEWEST_CASES = {
  open: { now: "2026-11-04T18:30:00Z", pieces: PIECES },
  closed: { now: "2026-11-07T15:00:00Z", pieces: PIECES },
  unreadable: { now: "2026-11-04T18:30:00Z", pieces: [{ id: "unreadable", text: "The portfolio snapshot and the digest couldn't be read for this request." }] as PortfolioPiece[] },
  no_block: { now: "2026-11-04T18:30:00Z", pieces: null },
} as const;

export type ChatNewestCaseName = keyof typeof CHAT_NEWEST_CASES;

/** The conversation each case is put on: the newest owner message gets them. */
export const CHAT_NEWEST_THREAD = [
  { role: "user" as const, content: "first" },
  { role: "assistant" as const, content: "answer" },
  { role: "user" as const, content: "second" },
];
