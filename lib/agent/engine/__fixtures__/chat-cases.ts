/**
 * The chat's instructions in each shape they take: at the portfolio level
 * with and without each analyst's room, and pinned to an analyst with its
 * money and book and with neither (../chat.engine.test.ts).
 */
export const CHAT_ANALYST = {
  id: "analyst_case",
  name: "Case Analyst",
  analystPrompt: "You buy companies whose sales keep growing.",
  setupIds: ["BASE_BREAKOUT", "MA_PULLBACK"],
  sectors: ["Information Technology"],
  marketCapMin: BigInt(2_000_000_000),
  marketCapMax: null,
  exclusionList: ["XXX"],
  watchlist: ["AAA", "BBB"],
  maxPositionSize: 10000,
  minPositionSize: 3000,
  maxOpenPositions: 6,
};

export const CHAT_CASES = {
  unscoped: { scopedAnalyst: null },
  unscoped_rooms: { scopedAnalyst: null, roomLines: ["Case Analyst: 4 of 6 held, 2 free", "Other Analyst: FULL, 5 of 5"] },
  pinned: {
    scopedAnalyst: CHAT_ANALYST,
    room: { open: 4, max: 6, held: ["AAA", "CCC", "DDD", "EEE"] },
    moneyBlock: "ACCOUNT MONEY CONTEXT\n  • Equity $100,000 · position band $3,000–$10,000",
    bookBlock: "THIS SEAT'S BOOK (live)\n  • $AAA 10 sh @ $100.00 ≈ $1,100",
  },
  pinned_bare: { scopedAnalyst: CHAT_ANALYST },
} as const;

export type ChatCaseName = keyof typeof CHAT_CASES;
