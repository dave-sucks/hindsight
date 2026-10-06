import { moveDollar } from "./move-dollar";

describe("moveDollar", () => {
  // IOT on 2026-10-04: 300 shares at $41.00, −0.29% on the day.
  it("inverts the percent exactly", () => {
    const d = moveDollar({ shares: 300, currentPrice: 41, pct: -0.29 });
    const then = 41 / (1 - 0.0029);
    expect(d).toBeCloseTo(300 * (41 - then), 6);
    expect(d!).toBeLessThan(0);
  });

  it("round-trips: the dollar move back to a percent is the percent given", () => {
    const shares = 29;
    const currentPrice = 333.6;
    const pct = -0.03;
    const d = moveDollar({ shares, currentPrice, pct })!;
    const thenTotal = shares * currentPrice - d;
    expect((d / thenTotal) * 100).toBeCloseTo(pct, 10);
  });

  it("a gain is positive", () => {
    expect(moveDollar({ shares: 43, currentPrice: 118.9, pct: 2.3 })!).toBeGreaterThan(0);
  });

  // The twelve open LIVE positions on 2026-10-06, as measured (shares and
  // price from Alpaca, pct against the previous close).
  const BOOK = [
    { ticker: "CEG", shares: 51, currentPrice: 296.75, pct: 10.88 },
    { ticker: "GEV", shares: 9, currentPrice: 1030.49, pct: 4.09 },
    { ticker: "PLTR", shares: 38, currentPrice: 191.83, pct: 1.28 },
    { ticker: "MSFT", shares: 17, currentPrice: 529.51, pct: 0.82 },
    { ticker: "NVDA", shares: 33, currentPrice: 240.2, pct: 0.54 },
    { ticker: "AAPL", shares: 29, currentPrice: 333.88, pct: 0.3 },
    { ticker: "V", shares: 27, currentPrice: 370.64, pct: 0.25 },
    { ticker: "CORT", shares: 43, currentPrice: 121, pct: -0.84 },
    { ticker: "WST", shares: 20, currentPrice: 372.64, pct: -1.09 },
    { ticker: "ASML", shares: 5, currentPrice: 1834.1, pct: -1.39 },
    { ticker: "IOT", shares: 300, currentPrice: 41.74, pct: -1.53 },
    { ticker: "MU", shares: 13, currentPrice: 1044.69, pct: -1.81 },
  ];

  // The point of the $ column: percents cannot be added, dollars can. This is
  // the number that reconciles with the header; a column of percents never
  // could, whatever order it is in.
  it("turns the column into something that sums", () => {
    const total = BOOK.reduce((t, r) => t + (moveDollar(r) ?? 0), 0);
    // $1,411.71 live; $0.81 of the difference is this fixture rounding each
    // percent to two places, which is what the column renders anyway.
    expect(total).toBeCloseTo(1410.9, 1);
  });

  it("each cell is the exact inversion of its percent", () => {
    for (const r of BOOK) {
      const d = moveDollar(r)!;
      const then = r.currentPrice / (1 + r.pct / 100);
      expect(d).toBeCloseTo(r.shares * (r.currentPrice - then), 6);
    }
  });

  // Worth stating because it was the assumption going in and the data says
  // otherwise: on this book the dollar order matched the percent order exactly
  // — the positions are all $5k–$15k, so nothing reorders. The $ column earns
  // its place by being summable, not by reranking the rows.
  it("does not rerank this book — the positions are too evenly sized", () => {
    const byPct = [...BOOK].sort((a, b) => b.pct - a.pct).map((r) => r.ticker);
    const byDollar = [...BOOK]
      .sort((a, b) => (moveDollar(b) ?? 0) - (moveDollar(a) ?? 0))
      .map((r) => r.ticker);
    expect(byDollar).toEqual(byPct);
  });

  it("says nothing when there is nothing to say", () => {
    // A watched name holds no shares.
    expect(moveDollar({ shares: null, currentPrice: 118.9, pct: 2.3 })).toBeNull();
    expect(moveDollar({ shares: 0, currentPrice: 118.9, pct: 2.3 })).toBeNull();
    expect(moveDollar({ shares: 10, currentPrice: null, pct: 2.3 })).toBeNull();
    expect(moveDollar({ shares: 10, currentPrice: 118.9, pct: null })).toBeNull();
    // No starting close to divide by.
    expect(moveDollar({ shares: 10, currentPrice: 118.9, pct: -100 })).toBeNull();
  });

  it("a flat window is zero, not absent", () => {
    expect(moveDollar({ shares: 5, currentPrice: 1867.31, pct: 0 })).toBe(0);
  });

  // 5D/30D use the same inversion — nothing about it is day-specific.
  it("works over any window, not just a day", () => {
    const thirty = moveDollar({ shares: 300, currentPrice: 41.9, pct: 4.23 })!;
    expect(thirty).toBeCloseTo(300 * (41.9 - 41.9 / 1.0423), 6);
  });
});
