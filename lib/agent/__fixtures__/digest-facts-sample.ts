/**
 * digest-facts-sample.ts — the Portfolio Reviewer's facts for Tue Nov 10 as
 * the 8 PM job builds them, from the stand-in book (account-2026-11-10.json):
 * the real closes, stand-in quantities, costs and cash. The real digest is not
 * kept in this public repo. The account is valued at the close
 * (lib/portfolio/value-at-quotes.ts); the day's runs, trades and decisions are
 * left empty, since no test reads them.
 */
import nov10 from "./account-2026-11-10.json";
import type { DigestFacts } from "@/lib/portfolio/digest-facts";
import { dayChangeAt, priceBook } from "@/lib/portfolio/value-at-quotes";

const quotes = Object.fromEntries(
  Object.entries(nov10.quotes).map(([s, q]) => [s, { quote: { ...q, d: null, dp: null, o: null, h: null, l: null, source: "alpaca" as const } }]),
);
/** The book at the close: the broker's positions, each at the app's quote. */
export const SAMPLE_BOOK = priceBook(Number(nov10.broker.cash), nov10.positions, quotes, false);
const day = dayChangeAt(SAMPLE_BOOK, { equity: Number(nov10.broker.last_equity), asOf: nov10.broker.balance_asof }, [], "2026-11-10")!;
/** Stand-in: what the account was funded with. */
const CONTRIBUTED = 100_000;
const ANALYST: Record<string, string> = { IOT: "PEAD Specialist", NVDA: "PEAD Specialist" };

export const SAMPLE_FACTS: DigestFacts = {
  version: 1,
  accountId: "account_live",
  date: "2026-11-10",
  generatedAtIso: nov10.at,
  hadAlpaca: true,
  runs: [],
  runRollup: { daily: 0, tactical: 0, discovery: 0, failed: 0 },
  decisions: [],
  trades: [],
  book: {
    heldCount: nov10.positions.length,
    capacity: 20,
    slotsUsedLabel: `${nov10.positions.length}/20`,
    cash: Number(nov10.broker.cash),
    buyingPower: Number(nov10.broker.buying_power),
    totalEquity: SAMPLE_BOOK.value,
    longMarketValue: SAMPLE_BOOK.long,
    shortMarketValue: 0,
    grossExposure: SAMPLE_BOOK.long,
    topSectorConcentration: null,
    topSector: null,
    held: nov10.positions.map((p) => {
      const price = nov10.quotes[p.symbol as keyof typeof nov10.quotes].c;
      const cost = Number(p.avg_entry_price);
      return {
        positionId: `position_${p.symbol.toLowerCase()}`,
        thesisId: `thesis_${p.symbol.toLowerCase()}`,
        ticker: p.symbol,
        direction: "LONG",
        quantity: Number(p.qty),
        avgCost: cost,
        analystId: null,
        analystName: ANALYST[p.symbol] ?? "Secular Compounder",
        currentPrice: price,
        sinceEntryPct: (price / cost - 1) * 100,
        dayChangePct: null,
      };
    }),
    closeOf: SAMPLE_BOOK.closeOf,
    marketOpen: false,
  },
  pnl: {
    dayPnl: day.dollars,
    dayPnlPct: day.pct,
    totalPnl: SAMPLE_BOOK.value - CONTRIBUTED,
    totalPnlPct: ((SAMPLE_BOOK.value - CONTRIBUTED) / CONTRIBUTED) * 100,
    netContributed: CONTRIBUTED,
    realizedToday: 0,
  },
  passesAged: [],
  cadence: { slotsUsed: nov10.positions.length, slotsTotal: 20, fullyDeployed: false, idleCash: Number(nov10.broker.cash), daysSinceLastNewEntry: 0, pendingProposals: 4 },
};
