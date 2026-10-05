import { dayDollarMove } from "./day-move";

describe("dayDollarMove", () => {
  // IOT on 2026-10-04: 300 shares at $41.00, −0.29% on the day.
  it("inverts the percent exactly", () => {
    const d = dayDollarMove({ shares: 300, currentPrice: 41, oneDayPct: -0.29 });
    const prevClose = 41 / (1 - 0.0029);
    expect(d).toBeCloseTo(300 * (41 - prevClose), 6);
    expect(d!).toBeLessThan(0);
  });

  it("round-trips: the dollar move back to a percent is the percent given", () => {
    const shares = 29;
    const currentPrice = 333.6;
    const pct = -0.03;
    const d = dayDollarMove({ shares, currentPrice, oneDayPct: pct })!;
    const prevCloseTotal = shares * currentPrice - d;
    expect((d / prevCloseTotal) * 100).toBeCloseTo(pct, 10);
  });

  it("a gain is positive", () => {
    expect(dayDollarMove({ shares: 43, currentPrice: 118.9, oneDayPct: 2.3 })!).toBeGreaterThan(0);
  });

  it("says nothing when there is nothing to say", () => {
    // A watched name holds no shares.
    expect(dayDollarMove({ shares: null, currentPrice: 118.9, oneDayPct: 2.3 })).toBeNull();
    expect(dayDollarMove({ shares: 0, currentPrice: 118.9, oneDayPct: 2.3 })).toBeNull();
    expect(dayDollarMove({ shares: 10, currentPrice: null, oneDayPct: 2.3 })).toBeNull();
    expect(dayDollarMove({ shares: 10, currentPrice: 118.9, oneDayPct: null })).toBeNull();
    // No previous close to divide by.
    expect(dayDollarMove({ shares: 10, currentPrice: 118.9, oneDayPct: -100 })).toBeNull();
  });

  it("a flat day is zero, not absent", () => {
    expect(dayDollarMove({ shares: 5, currentPrice: 1867.31, oneDayPct: 0 })).toBe(0);
  });
});
