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

  // The whole point of the $ mode. These are the live rows from 2026-10-06:
  // six of the eight names were green on the day, and the book still lost
  // money, because the red ones are the bigger positions.
  it("explains a red portfolio under a mostly-green column", () => {
    const BOOK = [
      { ticker: "MSFT", shares: 17, currentPrice: 529.7, pct: 0.86 },
      { ticker: "V", shares: 27, currentPrice: 370.63, pct: 0.25 },
      { ticker: "AAPL", shares: 29, currentPrice: 333.9, pct: 0.3 },
      { ticker: "PLTR", shares: 38, currentPrice: 191.87, pct: 1.3 },
      { ticker: "IOT", shares: 300, currentPrice: 41.9, pct: -1.16 },
      { ticker: "ASML", shares: 5, currentPrice: 1833, pct: -1.44 },
      { ticker: "WST", shares: 20, currentPrice: 372.29, pct: -1.19 },
      { ticker: "MU", shares: 13, currentPrice: 1046.75, pct: -1.62 },
    ];
    const green = BOOK.filter((r) => r.pct > 0);
    const red = BOOK.filter((r) => r.pct < 0);
    expect(green.length).toBeGreaterThan(red.length); // more names up than down

    const sum = (rows: typeof BOOK) =>
      rows.reduce((t, r) => t + (moveDollar(r) ?? 0), 0);
    // ...and the money still goes the other way.
    expect(sum(red) + sum(green)).toBeLessThan(0);
    expect(Math.abs(sum(red))).toBeGreaterThan(sum(green));
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
