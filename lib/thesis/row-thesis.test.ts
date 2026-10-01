/**
 * Built from the real rows on 2026-10-01, the morning Dave bought GEV and the
 * trade row opened a thesis the firm had PASSED on.
 */
import { thesisForTradeRow } from "./row-thesis";

// GEV's three theses, newest-updated first, exactly as the query returns them.
const GEV = [
  { id: "cmqeh7sxx000", status: "PASSED" }, // PEAD Specialist, Jun 15
  { id: "cmqb2nt4b001", status: "HOLDING" }, // Secular Compounder, Jun 12
  { id: "cmpykv073000", status: "PASSED" }, // PEAD Specialist, Jun 3
];

describe("thesisForTradeRow", () => {
  it("GEV: the buy's own decision wins over the newest thesis on the ticker", () => {
    expect(
      thesisForTradeRow({ decisionThesisId: "cmqb2nt4b001", tickerTheses: GEV }),
    ).toBe("cmqb2nt4b001");
  });

  it("GEV without a decision: a live thesis still beats a newer PASSED one", () => {
    expect(thesisForTradeRow({ decisionThesisId: null, tickerTheses: GEV })).toBe(
      "cmqb2nt4b001",
    );
  });

  // CEG, the other half: the position is LIVE and its thesis is PAPER, so the
  // by-ticker lookup (fenced to one environment) returns nothing at all.
  it("CEG: a decision is used when the ticker lookup is empty", () => {
    expect(thesisForTradeRow({ decisionThesisId: "ceg-paper", tickerTheses: [] })).toBe(
      "ceg-paper",
    );
  });

  it("falls back to the newest thesis when none is live", () => {
    expect(
      thesisForTradeRow({
        decisionThesisId: null,
        tickerTheses: [
          { id: "newest-retired", status: "RETIRED" },
          { id: "older-passed", status: "PASSED" },
        ],
      }),
    ).toBe("newest-retired");
  });

  it("returns null rather than guessing when there is nothing", () => {
    expect(thesisForTradeRow({ decisionThesisId: null, tickerTheses: [] })).toBeNull();
  });
});
