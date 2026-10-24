import {
  pastThesisWord,
  positionGain,
  summarizeStockHistory,
  tradeStatusKey,
  type HistoryPosition,
  type HistoryThesis,
} from "./stock-history";

const thesis = (o: Partial<HistoryThesis> & { id: string }): HistoryThesis => ({
  status: "WATCHING",
  direction: "LONG",
  retiredReason: null,
  createdAt: "2026-10-01T00:00:00Z",
  analystId: "a1",
  analystName: "Secular Compounder",
  ...o,
});

const position = (o: Partial<HistoryPosition> & { id: string }): HistoryPosition => ({
  thesisId: null,
  status: "CLOSED",
  direction: "LONG",
  quantity: 10,
  avgCost: 100,
  closePrice: 110,
  realizedPnl: 100,
  outcome: "WIN",
  closeReason: "TARGET",
  openedAt: "2026-09-01T00:00:00Z",
  closedAt: "2026-09-20T00:00:00Z",
  analystId: "a1",
  analystName: "Secular Compounder",
  buyFilled: true,
  ...o,
});

describe("summarizeStockHistory", () => {
  // Shaped like PLTR on 2026-10-24: one holding, one sold trade, two passes,
  // one proven wrong, one sold thesis with no position row, one lapsed proposal.
  const history = {
    theses: [
      thesis({ id: "t-hold", status: "HOLDING", createdAt: "2026-06-22T00:00:00Z" }),
      thesis({ id: "t-pass-1", status: "PASSED", direction: null, createdAt: "2026-06-02T00:00:00Z" }),
      thesis({ id: "t-pass-2", status: "PASSED", direction: null, createdAt: "2026-05-31T00:00:00Z" }),
      thesis({ id: "t-sold", status: "RETIRED", retiredReason: "SOLD", analystId: "a2", analystName: "Momentum Breakout", createdAt: "2026-05-31T01:00:00Z" }),
      thesis({ id: "t-wrong", status: "RETIRED", retiredReason: "INVALIDATED", createdAt: "2026-05-23T00:00:00Z" }),
      thesis({ id: "t-sold-old", status: "RETIRED", retiredReason: "SOLD", createdAt: "2026-04-15T00:00:00Z" }),
      thesis({ id: "t-watch", status: "WATCHING", analystId: "a3", analystName: "Catalyst PM", createdAt: "2026-10-20T00:00:00Z" }),
    ],
    positions: [
      position({ id: "p-open", thesisId: "t-hold", status: "OPEN", quantity: 38, avgCost: 192.01, closePrice: null, realizedPnl: null, outcome: null, closeReason: null, openedAt: "2026-10-02T00:00:00Z", closedAt: null }),
      position({ id: "p-sold", thesisId: "t-sold", quantity: 24.94, avgCost: 160.39, closePrice: 152.4, realizedPnl: -199.3, outcome: "LOSS", closeReason: "STOP", analystId: "a2", analystName: "Momentum Breakout", openedAt: "2026-06-02T00:00:00Z", closedAt: "2026-06-10T00:00:00Z" }),
      // A proposal that lapsed: a CANCELLED row carrying the proposed price. Never a trade.
      position({ id: "p-lapsed", thesisId: "t-watch", status: "CANCELLED", closePrice: null, realizedPnl: null, outcome: null, closeReason: null, buyFilled: false, openedAt: "2026-10-21T00:00:00Z", closedAt: null }),
      // A close row whose buy never filled (MSFT in prod). Never a trade either.
      position({ id: "p-nofill", thesisId: null, status: "CLOSED", closePrice: null, realizedPnl: null, outcome: null, buyFilled: false, openedAt: "2026-03-01T00:00:00Z", closedAt: "2026-03-02T00:00:00Z" }),
    ],
  };

  const s = summarizeStockHistory(history, 196.75);

  it("finds the open position and the thesis behind it", () => {
    expect(s.open?.id).toBe("p-open");
    expect(s.holding?.id).toBe("t-hold");
    expect(s.proposed).toBeNull();
  });

  it("counts only filled buys as trades, and never a lapsed proposal", () => {
    expect(s.closed.map((c) => c.id)).toEqual(["p-sold"]);
    expect(s.unfilled.map((p) => p.id).sort()).toEqual(["p-lapsed", "p-nofill"]);
    expect(s.stats).toEqual({ buys: 2, won: 0, lost: 1, realized: -199.3 });
  });

  it("splits theses into watching now and past, newest first", () => {
    expect(s.watching.map((t) => t.id)).toEqual(["t-watch"]);
    expect(s.past.map((t) => t.id)).toEqual(["t-pass-1", "t-sold", "t-pass-2", "t-wrong", "t-sold-old"]);
  });

  it("counts a sold thesis as bought even without a position row", () => {
    // t-pass-1, t-pass-2, t-wrong never bought; t-sold and t-sold-old did.
    expect(s.neverBought).toBe(3);
  });

  it("prices the open position against the live quote and the closed one off its fill", () => {
    expect(s.closed[0].gain).toEqual({ dollar: -199.3, pct: expect.closeTo((-199.3 / (160.39 * 24.94)) * 100, 6) });
    expect(positionGain(s.open!, 196.75)).toEqual({ dollar: expect.closeTo((196.75 - 192.01) * 38, 6), pct: expect.closeTo(((196.75 - 192.01) / 192.01) * 100, 6) });
    expect(positionGain(s.open!, null)).toBeNull();
  });
});

describe("tradeStatusKey", () => {
  it("never calls an unfilled row sold", () => {
    expect(tradeStatusKey({ status: "CANCELLED", outcome: null, realizedPnl: null, buyFilled: false })).toBe("CANCELLED");
    expect(tradeStatusKey({ status: "CLOSED", outcome: null, realizedPnl: null, buyFilled: false })).toBe("CANCELLED");
    expect(tradeStatusKey({ status: "OPEN", outcome: null, realizedPnl: null, buyFilled: false })).toBe("PENDING");
    expect(tradeStatusKey({ status: "PENDING_APPROVAL", outcome: null, realizedPnl: null, buyFilled: false })).toBe("PENDING");
  });
  it("reads the outcome, then the realized number", () => {
    expect(tradeStatusKey({ status: "CLOSED", outcome: "WIN", realizedPnl: 1, buyFilled: true })).toBe("CLOSED_WIN");
    expect(tradeStatusKey({ status: "CLOSED", outcome: null, realizedPnl: -1, buyFilled: true })).toBe("CLOSED_LOSS");
    expect(tradeStatusKey({ status: "CLOSED", outcome: null, realizedPnl: 0, buyFilled: true })).toBe("CLOSED_EXPIRED");
    expect(tradeStatusKey({ status: "OPEN", outcome: null, realizedPnl: null, buyFilled: true })).toBe("OPEN");
  });
});

describe("pastThesisWord", () => {
  it("says how a thesis ended in one word", () => {
    expect(pastThesisWord({ status: "PASSED", retiredReason: null })).toBe("Passed");
    expect(pastThesisWord({ status: "RETIRED", retiredReason: "SOLD" })).toBe("Sold");
    expect(pastThesisWord({ status: "RETIRED", retiredReason: "INVALIDATED" })).toBe("Proven wrong");
    expect(pastThesisWord({ status: "RETIRED", retiredReason: "DROPPED" })).toBe("Dropped");
    expect(pastThesisWord({ status: "RETIRED", retiredReason: "REPLACED" })).toBe("Replaced");
  });
});
