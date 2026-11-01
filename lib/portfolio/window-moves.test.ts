import { windowMoves } from "@/lib/portfolio/window-moves";

const bar = (date: string, close: number) => ({ date, close });

describe("windowMoves", () => {
  const candles = [
    bar("2026-09-15", 80),
    bar("2026-09-18", 90),
    bar("2026-10-09", 95),
    bar("2026-10-12", 96),
    bar("2026-10-13", 97),
    bar("2026-10-14", 98),
    bar("2026-10-15", 99),
    bar("2026-10-16", 100),
    bar("2026-10-19", 104), // today's partial bar — dropped
  ];

  it("measures from completed closes only", () => {
    const m = windowMoves(candles, 110, "2026-10-19");
    expect(m.oneDayPct).toBeCloseTo(10); // vs 100
    expect(m.fiveDayPct).toBeCloseTo(((110 - 96) / 96) * 100); // five sessions back
    expect(m.thirtyDayPct).toBeCloseTo(((110 - 90) / 90) * 100); // last close on/before 09-19
  });

  it("is null when there is no bar to measure from", () => {
    expect(windowMoves([], 110, "2026-10-19")).toEqual({
      oneDayPct: null,
      fiveDayPct: null,
      thirtyDayPct: null,
    });
  });
});

/**
 * MSFT on Saturday 2026-10-31. Thursday closed at $530.14, Friday at $521.91,
 * and outside the session the price is Friday's close, stamped at Friday's
 * bell — so it belongs to Friday. Measured against Saturday, every row on the
 * homepage read +0.00% while the sheet header said −1.55%.
 */
describe("a weekend: the price is Friday's close and belongs to Friday", () => {
  const candles = [
    bar("2026-10-23", 517.0),
    bar("2026-10-26", 520.6),
    bar("2026-10-27", 525.5),
    bar("2026-10-28", 531.01),
    bar("2026-10-29", 530.14),
    bar("2026-10-30", 521.91),
  ];

  it("1D is Friday against Thursday, −1.55%, when the price's day is Friday", () => {
    const m = windowMoves(candles, 521.91, "2026-10-30");
    expect(m.oneDayPct).toBeCloseTo(((521.91 - 530.14) / 530.14) * 100, 6);
    expect(m.fiveDayPct).toBeCloseTo(((521.91 - 517.0) / 517.0) * 100, 6);
  });

  it("measured against Saturday it would read 0.00% — the number nobody wants", () => {
    expect(windowMoves(candles, 521.91, "2026-10-31").oneDayPct).toBe(0);
  });
});
