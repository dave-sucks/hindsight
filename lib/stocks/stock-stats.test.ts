import { rangeBars, overviewStatColumns, keyFigureColumns, companyFactRows, financialStatSections } from "./stock-stats";

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
const quote = { o: 204.5, h: 206.1, l: 201.2, c: 203.8 };

describe("the Overview's block", () => {
  it("is two range bars, today's and the year's, around the current price", () => {
    expect(rangeBars(quote, nvda)).toEqual([
      { label: "Today", low: 201.2, high: 206.1, current: 203.8 },
      { label: "52 week", low: 164.27, high: 243.37, current: 203.8 },
    ]);
  });

  it("is six stats down two columns, in dollars, from the metric map", () => {
    const cols = overviewStatColumns(nvda, 4_931_824_000_000);
    expect(cols.map((c) => c.length)).toEqual([3, 3]);
    expect(cols[0][0]).toEqual({ label: "Market cap", value: "$4.93T" });
    expect(cols[0][2]).toEqual({ label: "EPS", value: "$7.91" });
    expect(cols[1][1]).toEqual({ label: "Volume, 3-month avg", value: "120.03M" });
    expect(cols[1][2]).toEqual({ label: "Beta", value: "2.28" });
  });

  it("prints — for what it has not got, never a guess", () => {
    expect(rangeBars(null, null)).toEqual([
      { label: "Today", low: null, high: null, current: null },
      { label: "52 week", low: null, high: null, current: null },
    ]);
    expect(overviewStatColumns(null, null).flat().every((s) => s.value === "—")).toBe(true);
    expect(keyFigureColumns(null, null).flat().every((s) => s.value === "—")).toBe(true);
  });
});

describe("the Fundamentals tab's top", () => {
  it("is the key figures in two columns of five", () => {
    const cols = keyFigureColumns(nvda, 4_931_824_000_000);
    expect(cols.map((c) => c.length)).toEqual([5, 5]);
    expect(cols[0][3]).toEqual({ label: "Forward P/E", value: "14.47" });
    expect(cols[1][0]).toEqual({ label: "Revenue growth, TTM", value: "+83.4%" });
    expect(cols[1][3]).toEqual({ label: "Dividend yield", value: "0.03%" });
  });

  it("is the company's facts, the website a link, the next report a day", () => {
    const rows = companyFactRows(
      { finnhubIndustry: "Semiconductors", country: "US", ipo: "1999-01-22", shareOutstanding: 24300, weburl: "https://www.nvidia.com/" },
      "NASDAQ",
      "2026-02-25",
    );
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Industry", "Semiconductors"],
      ["Exchange", "NASDAQ"],
      ["Country", "US"],
      ["IPO", "1999-01-22"],
      ["Shares outstanding", "24.30B"],
      ["Next earnings", "Feb 25"],
      ["Website", "nvidia.com"],
    ]);
    expect(rows[6].href).toBe("https://www.nvidia.com/");
    expect(companyFactRows(null, null, null).map((r) => r.value)).toEqual(["—", "—", "—", "—", "—", "—"]);
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
