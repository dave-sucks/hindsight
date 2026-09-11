/**
 * setup-scorecard.test.ts — R and give-back on trades whose answer is known.
 */

import {
  buildScorecard,
  giveBackPts,
  parseStopFromDecision,
  scorecardLines,
  tradeR,
  type ClosedTrade,
} from "./setup-scorecard";

const d = (s: string) => new Date(`${s}T15:00:00Z`);
const trade = (over: Partial<ClosedTrade>): ClosedTrade => ({
  setupId: "BASE_BREAKOUT",
  horizon: "TARGET",
  analyst: "PEAD Specialist",
  environment: "LIVE",
  direction: "LONG",
  entry: 100,
  initialStop: 92,
  close: 116,
  peak: 124,
  openedAt: d("2026-08-01"),
  closedAt: d("2026-08-11"),
  ...over,
});

describe("tradeR", () => {
  it("is the gain in units of the risk taken at entry", () => {
    // Risked $8, made $16 → +2R.
    expect(tradeR(trade({}))).toBe(2);
    // Stopped out at the stop → −1R.
    expect(tradeR(trade({ close: 92 }))).toBe(-1);
  });
  it("measures a short from a stop above entry", () => {
    expect(tradeR(trade({ direction: "SHORT", entry: 100, initialStop: 105, close: 90 }))).toBe(2);
  });
  it("is null with no entry stop, or one on the wrong side", () => {
    expect(tradeR(trade({ initialStop: null }))).toBeNull();
    expect(tradeR(trade({ initialStop: 101 }))).toBeNull();
  });
});

describe("giveBackPts", () => {
  it("is the peak gain minus the gain at the sale, in points", () => {
    // Peak +24%, sold +16% → 8 points given back.
    expect(giveBackPts(trade({}))).toBe(8);
  });
  it("never negative; null with no peak", () => {
    expect(giveBackPts(trade({ peak: 110 }))).toBe(0);
    expect(giveBackPts(trade({ peak: null }))).toBeNull();
  });
});

describe("parseStopFromDecision", () => {
  it("reads the entry stop off an INITIATE decision", () => {
    expect(parseStopFromDecision("LONG 12 shares — submitting market order (target $95.00, stop $74.00)")).toBe(74);
    expect(parseStopFromDecision("LONG 5 shares — submitting market order (target $1,150.00, stop $1,020.50)")).toBe(1020.5);
    expect(parseStopFromDecision("no stop here")).toBeNull();
    expect(parseStopFromDecision(null)).toBeNull();
  });
});

describe("buildScorecard", () => {
  const trades = [
    trade({}), // +2R, 8pts, 10d
    trade({ close: 92, peak: 104 }), // −1R, 12pts given back, loss
    trade({ setupId: null, horizon: "COMPOUNDER", analyst: "Secular Compounder", close: 130, peak: 140 }),
  ];
  const rows = buildScorecard(trades, [
    { setupId: "BASE_BREAKOUT", horizon: "TARGET", analyst: "PEAD Specialist", environment: "LIVE", proposals: 4, declined: 3 },
    { setupId: "MA_PULLBACK", horizon: "TARGET", analyst: "PEAD Specialist", environment: "LIVE", proposals: 2, declined: 2 },
  ]);

  it("groups by setup × horizon × analyst × environment", () => {
    const b = rows.find((r) => r.setupId === "BASE_BREAKOUT")!;
    expect(b).toMatchObject({
      setupName: "Base breakout (VCP / cup-with-handle / flat base)",
      trades: 2,
      wins: 1,
      winRatePct: 50,
      avgR: 0.5,
      rTrades: 2,
      avgHoldDays: 10,
      avgGiveBackPts: 10,
      sellProposals: 4,
      sellDeclined: 3,
      declineRatePct: 75,
    });
  });

  it("files a thesis with no setup under Unlabelled", () => {
    expect(rows.find((r) => r.setupId == null)?.setupName).toBe("Unlabelled");
  });

  it("keeps a setup that has sell proposals but no closed trade yet", () => {
    const p = rows.find((r) => r.setupId === "MA_PULLBACK")!;
    expect(p.trades).toBe(0);
    expect(p.declineRatePct).toBe(100);
    expect(p.avgR).toBeNull();
  });
});

describe("scorecardLines", () => {
  it("one data line per setup, the prompt format", () => {
    expect(scorecardLines([trade({}), trade({ close: 92, peak: 104 })])).toEqual([
      "Base breakout (VCP / cup-with-handle / flat base): 2 trades, 50% win, +0.5R, 10d held, 10.0pts given back from the peak.",
    ]);
  });
  it("says nothing with no trades", () => {
    expect(scorecardLines([])).toEqual([]);
  });
});
