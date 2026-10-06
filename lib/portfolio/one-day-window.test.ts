import { oneDayWindow } from "./one-day-window";

// The live 15-minute series on 2026-10-06, trimmed to the shape that matters:
// five sessions, each 09:30–16:00 ET (13:30–20:00Z).
const p = (date: string, value: number) => ({ date, value });
const SERIES = [
  p("2026-10-05T13:30:00.000Z", 5_000),
  p("2026-10-05T16:00:00.000Z", 5_200),
  p("2026-10-05T20:00:00.000Z", 5_300), // prior close
  p("2026-10-06T13:30:00.000Z", 6_381), // today's open — the overnight gap
  p("2026-10-06T16:00:00.000Z", 6_100),
  p("2026-10-06T20:00:00.000Z", 5_958), // today's close
];

describe("oneDayWindow", () => {
  // THE BUG. Today's points alone measure from the OPEN, so the +$1,081
  // overnight gap falls outside the window the header reports — it read
  // −$423 on a day the book was up.
  it("starts at the previous session's close, not today's open", () => {
    const w = oneDayWindow(SERIES);
    expect(w[0].date).toBe("2026-10-05T20:00:00.000Z");
    expect(w[w.length - 1].date).toBe("2026-10-06T20:00:00.000Z");
  });

  it("the delta is the whole day, gap included", () => {
    const w = oneDayWindow(SERIES);
    const delta = w[w.length - 1].value - w[0].value;
    expect(delta).toBe(658); // 5_958 − 5_300
    // What the shipped window reported instead:
    const todayOnly = SERIES.filter((x) => x.date.slice(0, 10) === "2026-10-06");
    expect(todayOnly[todayOnly.length - 1].value - todayOnly[0].value).toBe(-423);
  });

  it("carries today's points through for the chart to draw", () => {
    const w = oneDayWindow(SERIES);
    expect(w).toHaveLength(4); // prior close + today's three
  });

  // A weekend or holiday is not special: the previous session is whatever
  // point precedes the newest day, however long ago that was.
  it("spans a weekend without special-casing it", () => {
    const overWeekend = [
      p("2026-10-02T20:00:00.000Z", 100), // Friday close
      p("2026-10-05T13:30:00.000Z", 120), // Monday open
      p("2026-10-05T20:00:00.000Z", 130),
    ];
    const w = oneDayWindow(overWeekend);
    expect(w[0].date).toBe("2026-10-02T20:00:00.000Z");
    expect(w[w.length - 1].value - w[0].value).toBe(30);
  });

  it("a daily series works too — the prior day's close is the prior point", () => {
    const daily = [p("2026-10-02", 100), p("2026-10-05", 130), p("2026-10-06", 125)];
    const w = oneDayWindow(daily);
    expect(w.map((x) => x.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(w[w.length - 1].value - w[0].value).toBe(-5);
  });

  it("falls back to the session itself when there is no earlier day", () => {
    const firstDay = [p("2026-10-06T13:30:00.000Z", 10), p("2026-10-06T20:00:00.000Z", 14)];
    expect(oneDayWindow(firstDay)).toHaveLength(2);
    expect(oneDayWindow(firstDay)[0].date).toBe("2026-10-06T13:30:00.000Z");
  });

  it("says nothing about an empty series", () => {
    expect(oneDayWindow([])).toEqual([]);
  });

  it("a single point is its own window", () => {
    expect(oneDayWindow([p("2026-10-06T20:00:00.000Z", 1)])).toHaveLength(1);
  });
});
