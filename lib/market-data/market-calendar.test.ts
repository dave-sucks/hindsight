/**
 * The market's own calendar, read from the morning of Wed Nov 11, 2026: the
 * producer price index two days out and PCE the day before Thanksgiving, as
 * BLS and BEA list them (read 2026-11-11).
 */
import { calendarGaps, scheduledMarketDates } from "./market-calendar";

describe("the market dates in the next 21 days, from Nov 11", () => {
  it("lists the producer price index and PCE with the others, in order", () => {
    expect(scheduledMarketDates("2026-11-11", 21).map((d) => [d.date, d.kind, d.what])).toEqual([
      ["2026-11-13", "PPI", "producer price index (PPI)"],
      ["2026-11-25", "PCE", "personal income and spending, with PCE inflation"],
    ]);
  });

  it("from Dec 1: the jobs report, the Fed, CPI and PPI; PCE on Dec 23 is a day past the window", () => {
    expect(scheduledMarketDates("2026-12-01", 21).map((d) => d.kind)).toEqual(["JOBS", "FED", "CPI", "PPI"]);
  });

  it("says when a list runs out inside the window, never goes quiet", () => {
    expect(calendarGaps("2026-11-11", 21)).toEqual([]);
    expect(calendarGaps("2027-12-20", 21).join(" ")).toContain("The producer price index dates on file end 2027-12-15");
  });
});
