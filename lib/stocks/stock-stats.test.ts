import { keyStatColumns, financialStatSections } from "./stock-stats";

// A slice of Finnhub's /stock/metric for NVDA, 2026-11-02.
const nvda = {
  "10DayAverageTradingVolume": 98.55906,
  "3MonthAverageTradingVolume": 120.02896,
  "52WeekHigh": 243.37,
  "52WeekLow": 164.27,
  "52WeekPriceReturnDaily": 0.8625,
  beta: 2.27608,
  dividendYieldIndicatedAnnual: 0.03349,
  enterpriseValue: 4942747,
  epsTTM: 7.9108,
  forwardPE: 14.47479,
  grossMarginTTM: 74.67,
  marketCapitalization: 4931824,
  peTTM: 25.5695,
  pegTTM: 0.45911,
  revenueGrowthTTMYoy: 83.38,
  yearToDatePriceReturnDaily: 9.7265,
  "priceRelativeToS&P50052Week": -10.3006,
};
const quote = { o: 204.5, h: 206.1, l: 201.2 };

describe("keyStatColumns", () => {
  it("is nine cells down three columns, in dollars, from the session's quote and the metric map", () => {
    const cols = keyStatColumns(quote, nvda, 4_931_824_000_000);
    expect(cols.map((c) => c.length)).toEqual([3, 3, 3]);
    expect(cols[0][0]).toEqual({ label: "Open", value: "$204.50" });
    expect(cols[1][0]).toEqual({ label: "Market cap", value: "$4.93T" });
    expect(cols[1][2]).toEqual({ label: "EPS", value: "$7.91" });
    expect(cols[2][2]).toEqual({ label: "Avg volume", value: "120.03M" });
  });

  it("prints — for what it has not got, never a guess", () => {
    const cols = keyStatColumns(null, null, null);
    expect(cols.flat().every((s) => s.value === "—")).toBe(true);
  });
});

describe("financialStatSections", () => {
  it("keeps the stats Finnhub has and drops the rest, section by section", () => {
    const sections = financialStatSections(nvda, 4_931_824_000_000);
    const valuation = sections.find((s) => s.label === "Valuation")!;
    expect(valuation.columns.flat().map((s) => s.label)).toEqual([
      "Market cap",
      "Enterprise value",
      "P/E (TTM)",
      "Forward P/E",
      "PEG",
    ]);
    expect(valuation.columns.flat().find((s) => s.label === "Forward P/E")!.value).toBe("14.47");
    // Growth has one number; Balance sheet and Per share partly; Profitability one.
    expect(sections.find((s) => s.label === "Growth")!.columns.flat()).toEqual([
      { label: "Revenue, TTM vs year ago", value: "+83.4%" },
    ]);
    expect(sections.find((s) => s.label === "Price")!.columns.flat().map((s) => s.value)).toEqual([
      "+0.9%",
      "+9.7%",
      "−10.3%",
    ]);
    expect(sections.find((s) => s.label === "Balance sheet")).toBeUndefined();
  });

  it("is empty with no metrics", () => {
    expect(financialStatSections(null, null)).toEqual([]);
  });
});
