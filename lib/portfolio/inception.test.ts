/**
 * The live book: history starts 2026-05-15, and the 15-minute series used by
 * 1D and 1W only reaches back a week.
 */
import { windowReachesInception } from "./inception";

const DAILY = [
  { date: "2026-05-15" },
  { date: "2026-08-01" },
  { date: "2026-10-03" },
];
const INTRADAY_WEEK = [
  { date: "2026-09-29T13:30:00.000Z" },
  { date: "2026-10-03T20:00:00.000Z" },
];

describe("windowReachesInception", () => {
  it("a week of intraday is NOT the whole account", () => {
    // The bug: compared against the intraday curve itself this was true, and
    // 1W showed the all-time total.
    expect(windowReachesInception(INTRADAY_WEEK, INTRADAY_WEEK)).toBe(true);
    expect(windowReachesInception(INTRADAY_WEEK, DAILY)).toBe(false);
  });

  it("a window starting on the first day IS the whole account", () => {
    expect(windowReachesInception(DAILY, DAILY)).toBe(true);
  });

  it("a window starting before the first day is the whole account too", () => {
    expect(windowReachesInception([{ date: "2026-01-01" }], DAILY)).toBe(true);
  });

  it("a window starting after it is not", () => {
    expect(windowReachesInception([{ date: "2026-08-01" }], DAILY)).toBe(false);
  });

  it("says no rather than guessing when either side is empty", () => {
    expect(windowReachesInception([], DAILY)).toBe(false);
    expect(windowReachesInception(DAILY, [])).toBe(false);
  });
});
