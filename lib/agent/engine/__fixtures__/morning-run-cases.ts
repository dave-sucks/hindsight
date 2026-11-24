/**
 * The morning run's prompt in each shape it takes, on a made-up book: a quiet
 * morning; a full one (reports this week and just in, filings, a buy price
 * reached, a buy waiting, two holdings, the
 * account's block); a morning whose snapshot couldn't be read; and one whose
 * filings couldn't be read (../morning-run.engine.test.ts).
 */
import type { RunInput } from "@/lib/agent/run-input";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";

const analyst = { name: "Case Analyst", analystPrompt: "You buy companies whose sales keep growing.", setupIds: ["BASE_BREAKOUT", "MA_PULLBACK"], maxPositionSize: 10000, minPositionSize: 3000, maxOpenPositions: 6 };

const quiet = {
  portfolio: { cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
  watchlist: [],
  activeTheses: [],
  triggersFiredSinceLastRun: [],
  triggersMatchingNow: [],
  earnings: { reportingSoon: [], justReported: [] },
  filings: { recent: [] },
};

const position = (symbol: string) => ({ symbol, direction: "LONG", quantity: 10, avgCost: 100, currentPrice: 110, unrealizedPnl: 100, unrealizedPnlPct: 10, targetPrice: null, stopLoss: null, exitStrategy: "", daysHeld: 20, activeThesisId: null, activeThesisSummary: null });

export const MORNING_PIECES: PortfolioPiece[] = [
  { id: "market_numbers", text: "### Market numbers (as of Wed, Nov 18, 8:02 AM ET)\n- S&P 500 (SPY) $600.00 −0.50%." },
  { id: "market_digest", text: "### Market digest (written Wed, Nov 18, 7:31 AM ET)\n#### Market overview\nStocks slipped." },
  { id: "portfolio_snapshot", text: "### Portfolio snapshot\nThe account, Tue, Nov 17\nValue $100,000.00" },
  { id: "portfolio_digest", text: "### Portfolio digest (written Tue, Nov 17, 8:00 PM ET)\nA quiet day." },
];

export const MORNING_CASES = {
  quiet: { analyst, runInput: quiet },
  full: {
    analyst,
    runInput: {
      ...quiet,
      pendingApprovalCount: 1,
      portfolio: { ...quiet.portfolio, cash: 41000, positions: [position("AAA"), position("BBB")] },
      triggersMatchingNow: [{ thesisId: "t1", ticker: "CCC", triggerId: "trg_buy", action: "ENTER", predicateSummary: "above $120", rationale: "The pivot.", matchDetail: "at $121" }],
      earnings: { reportingSoon: [{ ticker: "AAA", date: "2026-11-19", hour: "amc" }, { ticker: "DDD", date: "2026-11-20", hour: "bmo" }], justReported: [{ ticker: "BBB", date: "2026-11-16", summary: "EPS $1.10 vs $1.00 est, a beat" }] },
      filings: { recent: [{ ticker: "AAA", date: "2026-11-17", tier: "material", summary: "8-K — major agreement signed (1.01)", url: "https://www.sec.gov/example/aaa" }] },
    },
    pieces: MORNING_PIECES,
  },
  snapshot_unread: {
    analyst,
    runInput: quiet,
    pieces: [MORNING_PIECES[0], MORNING_PIECES[1], { id: "portfolio_snapshot", text: "### Portfolio snapshot\nThe portfolio snapshot couldn't be read for this request." }, MORNING_PIECES[3]] as PortfolioPiece[],
  },
  filings_unread: { analyst, runInput: { ...quiet, filings: { recent: [], error: "EDGAR timed out" } } },
} as const satisfies Record<string, { analyst: unknown; runInput: unknown; pieces?: PortfolioPiece[] }>;

export type MorningCaseName = keyof typeof MORNING_CASES;
export const asRunInput = (r: unknown) => r as RunInput;
