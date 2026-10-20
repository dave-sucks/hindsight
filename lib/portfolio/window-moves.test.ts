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
