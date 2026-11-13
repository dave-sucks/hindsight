jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildTrading, reasonName } from "./trading";
import type { ClosedTrade } from "./setup-scorecard";

const trade = (symbol: string, entry: number, close: number, over: Partial<ClosedTrade> = {}): ClosedTrade => ({
  symbol, setupId: null, horizon: null, analyst: "Compounder", environment: "LIVE", direction: "LONG",
  entry, initialStop: null, close, peak: null, openedAt: new Date("2026-10-01T15:00:00Z"), closedAt: new Date("2026-10-20T15:00:00Z"),
  realizedPnl: (close - entry) * 10, closeReason: "STOP", ...over,
});

describe("the Trading tab's numbers", () => {
  const trades = [
    trade("CEG", 100, 120, { closeReason: "TARGET", peak: 125, closedAt: new Date("2026-10-20T15:00:00Z") }), // +20%, gave back 5 pts
    trade("MU", 100, 92, { peak: 110, closedAt: new Date("2026-10-21T15:00:00Z") }), // −8%, up 10% first: a round trip
    trade("IOT", 50, 49, { peak: 51, closedAt: new Date("2026-10-21T19:00:00Z"), initialStop: 46 }), // −2%, −0.25R
    trade("NVDA", 200, 216, { closeReason: "MANUAL", closedAt: new Date("2026-08-01T15:00:00Z"), realizedPnl: null }), // outside 30 days, unpriced
  ];
  const w = buildTrading(trades, new Date("2026-10-15T00:00:00Z"));

  it("counts only the trades closed in the range, and splits wins from losses on the gain", () => {
    expect(w.summary).toMatchObject({ trades: 3, wins: 1, losses: 2, winRatePct: 33, pricedTrades: 3, avgWinPct: 20, avgLossPct: -5 });
  });

  it("gives profit factor as dollars won over dollars lost, and counts a winner that closed red as a round trip", () => {
    // Won 200; lost 80 + 10.
    expect(w.summary.profitFactor).toBe(2.22);
    expect(w.summary.realizedPnl).toBe(110);
    expect(w.summary.roundTrips).toBe(1);
  });

  it("adds realized dollars up by the day they closed, in New York time", () => {
    expect(w.curve).toEqual([
      { date: "2026-10-20", realized: 200, cumulative: 200 },
      { date: "2026-10-21", realized: -90, cumulative: 110 },
    ]);
  });

  it("buckets each trade's result and groups them by how they ended", () => {
    expect(w.distribution.filter((b) => b.n).map((b) => [b.label, b.n])).toEqual([["−10 to −5%", 1], ["−5 to 0%", 1], ["Above 20%", 1]]);
    expect(w.exits.map((e) => [e.reason, e.trades, e.winRatePct])).toEqual([["Stop", 2, 0], ["Target", 1, 100]]);
  });

  it("shows the best each trade was up beside where it closed", () => {
    expect(w.peaks.map((p) => [p.label, p.best, p.exit])).toEqual([["CEG 10/20", 25, 20], ["MU 10/21", 10, -8], ["IOT 10/21", 2, -2]]);
    expect(w.byAnalyst[0]).toMatchObject({ analyst: "Compounder", trades: 3, avgR: -0.2, avgGiveBackPts: 9 });
    expect(w.recent.map((r) => r.symbol)).toEqual(["IOT", "MU", "CEG"]);
  });

  it("takes every trade when there is no range", () => {
    expect(buildTrading(trades, null).summary.trades).toBe(4);
    expect(reasonName("THESIS_INVALIDATED")).toBe("Thesis invalidated");
  });
});
