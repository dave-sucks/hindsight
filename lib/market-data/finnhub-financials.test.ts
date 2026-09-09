/**
 * The filed-statement normalizer: concept fallbacks, derived gross profit
 * and FCF, amendment handling. Fixtures are trimmed from real Finnhub
 * responses (ETN 10-K FY2025, SMMT 10-Q Q1 2026, 2026-09-08).
 */
import { deCumulate, normalizeReport, pickConcept, type ReportedPeriod } from "./finnhub-financials";

const etn = {
  year: 2025, quarter: 0, form: "10-K", endDate: "2025-12-31 00:00:00", filedDate: "2026-02-20 00:00:00",
  report: {
    ic: [
      { concept: "us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax", value: 27448000000 },
      { concept: "us-gaap_CostOfRevenue", value: 17131000000 },
      { concept: "us-gaap_NetIncomeLoss", value: 4087000000 },
      { concept: "us-gaap_EarningsPerShareDiluted", value: 10.45 },
    ],
    cf: [
      { concept: "us-gaap_DepreciationDepletionAndAmortization", value: 1006000000 },
      { concept: "us-gaap_NetCashProvidedByUsedInOperatingActivities", value: 4472000000 },
      { concept: "us-gaap_PaymentsToAcquirePropertyPlantAndEquipment", value: 919000000 },
    ],
    bs: [
      { concept: "us-gaap_CashAndCashEquivalentsAtCarryingValue", value: 622000000 },
      { concept: "us-gaap_Assets", value: 41251000000 },
    ],
  },
};

describe("normalizeReport", () => {
  it("reads revenue through the concept fallback list and derives gross profit + FCF", () => {
    const row = normalizeReport(etn)!;
    expect(row.period).toBe("2025-12-31");
    expect(row.quarter).toBeNull(); // 10-K → fiscal year
    expect(row.revenue).toBe(27448000000);
    expect(row.grossProfit).toBe(27448000000 - 17131000000); // no GrossProfit concept filed
    expect(row.freeCashFlow).toBe(4472000000 - 919000000);
    expect(row.dilutedEps).toBe(10.45);
    expect(row.depreciation).toBe(1006000000);
    expect(row.equity).toBeNull(); // absent concept is null, never 0
  });

  it("keeps the quarter for a 10-Q and tolerates string values", () => {
    const row = normalizeReport({
      year: 2026, quarter: 1, form: "10-Q", endDate: "2026-03-31 00:00:00",
      report: { ic: [{ concept: "us-gaap_Revenues", value: "1000" }], cf: [], bs: [] },
    })!;
    expect(row.quarter).toBe(1);
    expect(row.revenue).toBe(1000);
  });

  it("returns null for a report with no period end", () => {
    expect(normalizeReport({ year: 2026, form: "10-Q" })).toBeNull();
  });
});

describe("pickConcept", () => {
  it("takes the first candidate present, in order", () => {
    const items = [
      { concept: "us-gaap_SalesRevenueNet", value: 5 },
      { concept: "us-gaap_Revenues", value: 9 },
    ];
    expect(pickConcept(items, ["Revenues", "SalesRevenueNet"])).toBe(9);
    expect(pickConcept(items, ["Nope"])).toBeNull();
    expect(pickConcept(undefined, ["Revenues"])).toBeNull();
  });
});

describe("deCumulate", () => {
  const base: Omit<ReportedPeriod, "period" | "periodStart" | "quarter" | "revenue" | "netIncome"> = {
    year: 2025, form: "10-Q", costOfRevenue: null, grossProfit: null, operatingIncome: null,
    dilutedEps: null, depreciation: null, operatingCashFlow: null, capex: null, freeCashFlow: null,
    cash: 100, totalAssets: null, equity: null,
  };
  it("turns year-to-date 10-Q flows into single quarters and leaves balance-sheet fields alone (ETN FY2025 shape)", () => {
    const rows: ReportedPeriod[] = [
      { ...base, period: "2025-03-31", periodStart: "2025-01-01", quarter: 1, revenue: 6377, netIncome: 900 },
      { ...base, period: "2025-06-30", periodStart: "2025-01-01", quarter: 2, revenue: 13404, netIncome: 1900 },
      { ...base, period: "2025-09-30", periodStart: "2025-01-01", quarter: 3, revenue: 20393, netIncome: 3000 },
      { ...base, period: "2026-03-31", periodStart: "2026-01-01", quarter: 1, year: 2026, revenue: 7451, netIncome: 1000 },
    ];
    const out = deCumulate(rows);
    expect(out.map((r) => r.revenue)).toEqual([6377, 13404 - 6377, 20393 - 13404, 7451]);
    expect(out.map((r) => r.netIncome)).toEqual([900, 1000, 1100, 1000]);
    expect(out.every((r) => r.cash === 100)).toBe(true);
  });
  it("leaves genuine three-month filings untouched", () => {
    const rows: ReportedPeriod[] = [
      { ...base, period: "2025-03-31", periodStart: "2025-01-01", quarter: 1, revenue: 10, netIncome: 1 },
      { ...base, period: "2025-06-30", periodStart: "2025-04-01", quarter: 2, revenue: 12, netIncome: 2 },
    ];
    expect(deCumulate(rows).map((r) => r.revenue)).toEqual([10, 12]);
  });
});
