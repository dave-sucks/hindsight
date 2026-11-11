/**
 * The Market tab's market numbers: printed by code from the numbers the run
 * read (its inputs, `facts.market`), worded as of when the digest was written.
 * Made-up numbers.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { numbersOf } from "./latest";

const WRITTEN = new Date("2026-11-11T12:41:00Z"); // 7:41 AM ET, before the open

describe("the Market tab's market numbers", () => {
  it("the lines every agent reads beside the brief, naming the session they are from", () => {
    const facts = {
      market: {
        session: "2026-11-10",
        spyPct: 1.32,
        qqqPct: -0.004,
        spyAverages: null,
        vix: { close: 19.46, prevClose: 19.92, asOf: "2026-11-10" },
        tenYear: null,
        sectors: [
          { ticker: "XLK", name: "Tech", pct: 3.2 },
          { ticker: "XLY", name: "Consumer discretionary", pct: -0.04 },
        ],
        dates: [{ date: "2026-11-13", kind: "PPI", what: "producer price index (PPI)" }],
        calendarGaps: [],
      },
    };
    expect(numbersOf(facts, WRITTEN)).toEqual([
      "S&P 500 (SPY) +1.32% on Tue Nov 10",
      // A move that rounds to zero has no sign.
      "Nasdaq (QQQ) 0.00% on Tue Nov 10",
      "VIX 19.46 (19.92 the day before) at the Tue Nov 10 close",
      "Sectors on Tue Nov 10, best to worst: Tech +3.2% · Consumer discretionary 0.0%",
      "Market dates in the next 7 days: Fri Nov 13 producer price index (PPI)",
    ]);
  });

  it("nothing when the row's inputs carry no market numbers", () => {
    expect(numbersOf({}, WRITTEN)).toEqual([]);
    expect(numbersOf(null, WRITTEN)).toEqual([]);
  });
});
