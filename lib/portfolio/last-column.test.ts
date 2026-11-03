import { lastColumn, gainOver } from "./last-column";

// V on 2026-11-03: a +14.22% holding on a −0.88% day — the row the desktop
// Lifetime column showed as −0.88% when the phone's toggle reached it.
const v = {
  sincePct: 14.22,
  sinceDollar: 1417.97,
  oneDayPct: -0.88,
  fiveDayPct: 4.95,
  thirtyDayPct: 16.94,
  shares: 27,
  currentPrice: 421.77,
  tradeState: "OPEN" as const,
};

describe("the last column", () => {
  it("is the lifetime gain on desktop whatever window the phone is on", () => {
    for (const window of ["1d", "5d", "30d", "lifetime"] as const) {
      expect(lastColumn(v, window).desktop).toEqual({ pct: 14.22, dollar: 1417.97 });
    }
  });

  it("is the phone's window on the phone", () => {
    expect(lastColumn(v, "1d").phone.pct).toBe(-0.88);
    expect(lastColumn(v, "1d").phone.dollar).toBeCloseTo(-101.1, 0);
    expect(lastColumn(v, "5d").phone.pct).toBe(4.95);
    expect(lastColumn(v, "30d").phone.pct).toBe(16.94);
    expect(lastColumn(v, "lifetime").phone).toEqual({ pct: 14.22, dollar: 1417.97 });
  });

  it("gives a watched name a percent and no dollars", () => {
    const watched = { ...v, tradeState: null, shares: null, sinceDollar: null };
    expect(gainOver(watched, "lifetime")).toEqual({ pct: 14.22, dollar: null });
    expect(gainOver(watched, "1d")).toEqual({ pct: -0.88, dollar: null });
  });
});
