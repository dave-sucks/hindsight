/**
 * The Market tab's market numbers: printed by code from the numbers the run
 * read (its inputs, `facts.market`). Made-up numbers.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { numbersOf } from "./latest";

describe("the Market tab's market numbers", () => {
  it("the lines the run read, each reading that wasn't there left out", () => {
    const facts = {
      market: {
        spy: { close: 735.29, changePct: 1.32, sma50: 765.68, sma200: 730.38, vs50Pct: -4, vs200Pct: 0.67, asOf: "2026-11-10" },
        nasdaq: { close: 656.1, changePct: -0.004 },
        vix: { close: 19.46, prevClose: 19.92, asOf: "2026-11-10" },
        tenYear: null,
        sectors: [
          { symbol: "XLK", name: "Tech", changePct: 3.2 },
          { symbol: "XLY", name: "Consumer discretionary", changePct: -0.004 },
        ],
      },
    };
    expect(numbersOf(facts)).toEqual([
      "S&P 500 (SPY) closed $735.29, +1.32% on the session: 4.0% below its 50-day ($765.68) and 0.7% above its 200-day ($730.38) (as of Tue Nov 10).",
      // A move that rounds to zero has no sign.
      "Nasdaq 100 (QQQ) closed $656.10, 0.00% on the session.",
      "The VIX closed 19.46 on Tue Nov 10, from 19.92 the session before.",
      "Sectors, largest move first: Tech +3.20%, Consumer discretionary 0.00%.",
    ]);
  });

  it("nothing when the row's inputs carry no market numbers", () => {
    expect(numbersOf({})).toEqual([]);
    expect(numbersOf(null)).toEqual([]);
  });
});
