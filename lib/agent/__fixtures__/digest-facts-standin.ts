/**
 * A day's digest facts with stand-in amounts (the real ones are the live
 * account's, and this repo is public): $100,000 contributed, two holdings, a
 * morning run, a review and a pass, in the shape buildDigestFacts returns.
 */
import type { DigestFacts } from "@/lib/portfolio/digest-facts";

const held = (ticker: string, quantity: number, avgCost: number, currentPrice: number) => ({
  positionId: `position_${ticker.toLowerCase()}`,
  thesisId: `thesis_${ticker.toLowerCase()}`,
  ticker,
  direction: "LONG",
  quantity,
  avgCost,
  analystId: "analyst_secular",
  analystName: "Secular Compounder",
  currentPrice,
  sinceEntryPct: (currentPrice / avgCost - 1) * 100,
  dayChangePct: -1.2,
});

export const STANDIN_FACTS: DigestFacts = {
  version: 1,
  accountId: "account_live",
  date: "2026-11-11",
  generatedAtIso: "2026-11-12T01:00:00.000Z",
  hadAlpaca: true,
  runs: [{ runId: "run_morning", mode: "MORNING_PLAN", status: "COMPLETE", analystId: "analyst_secular", analystName: "Secular Compounder", startedAtEt: "08:00", startedAtIso: "2026-11-11T13:00:00.000Z" }],
  runRollup: { daily: 1, tactical: 0, discovery: 0, failed: 0 },
  decisions: [{ thesisId: "thesis_msft", ticker: "MSFT", type: "REVIEWED", summary: "Case unchanged.", analystId: "analyst_secular", analystName: "Secular Compounder", runId: "run_morning", timeEt: "08:12", priceAtTime: 500 }],
  trades: [],
  book: {
    heldCount: 2,
    capacity: 20,
    slotsUsedLabel: "2/20",
    cash: 75_000,
    buyingPower: 150_000,
    totalEquity: 101_000,
    longMarketValue: 26_000,
    shortMarketValue: 0,
    grossExposure: 26_000,
    topSectorConcentration: null,
    topSector: null,
    held: [held("MSFT", 20, 480, 500), held("V", 50, 300, 320)],
  },
  pnl: { dayPnl: -300, dayPnlPct: -0.3, totalPnl: 1_000, totalPnlPct: 1, netContributed: 100_000, realizedToday: 0 },
  passesAged: [{ thesisId: "thesis_iot", ticker: "IOT", direction: "LONG", passedAtIso: "2026-11-04T14:00:00.000Z", daysSincePass: 7, priceAtPass: 40, currentPrice: 44, sincePassPct: 10, verdict: "MISSED" }],
  cadence: { slotsUsed: 2, slotsTotal: 20, fullyDeployed: false, idleCash: 75_000, daysSinceLastNewEntry: 3, pendingProposals: 0 },
};
