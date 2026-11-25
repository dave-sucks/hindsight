import { valuationLines } from "@/lib/agent/thesis-research/valuation";

// The blind test's ACN pull (2026-11-17): $247.70, 590.74M shares, the four
// reported quarters, the Street's year and next quarter, FY2026's filed year.
const ACN = {
  price: 247.7,
  marketCap: 247.7 * 590.74e6,
  quarterlyEps: [3.29, 3.8, 2.93, 3.94],
  epsFiscalYear: 14.68,
  epsNextQuarter: 3.9,
  lastYear: { year: "2026", revenue: 74_183e6, freeCashFlow: 11_621e6 },
};

describe("valuationLines", () => {
  it("works out each multiple at today's price and names what it divides by", () => {
    expect(valuationLines(ACN)).toBe(
      [
        "Earnings: 17.7× the last four quarters' EPS ($13.96) · 16.9× this fiscal year's EPS consensus ($14.68) · 15.9× next quarter's EPS consensus × 4 ($15.60)",
        "Sales: 2.0× 2026 revenue ($74.18B), on the market cap above",
        "Free cash flow: 7.9% yield on 2026's $11.62B",
      ].join("\n"),
    );
  });

  it("gives no multiple on a loss, and says so", () => {
    const out = valuationLines({ ...ACN, quarterlyEps: [-1, -0.5, 0.2, -0.3], epsFiscalYear: -0.4, epsNextQuarter: null });
    expect(out).toContain("no multiple on the last four quarters' EPS (a loss, $-1.60)");
    expect(out).toContain("no multiple on this fiscal year's EPS consensus (a loss, $-0.40)");
    expect(out).not.toContain("next quarter");
  });

  it("leaves out what it can't work out: fewer than four quarters, no market cap", () => {
    const out = valuationLines({ ...ACN, quarterlyEps: [3.29, 3.8], marketCap: null });
    expect(out).toBe("Earnings: 16.9× this fiscal year's EPS consensus ($14.68) · 15.9× next quarter's EPS consensus × 4 ($15.60)");
  });

  it("puts no multiple on a consensus off the same quarter's estimate on the reported basis, and says why (DOCU 2026-11-25)", () => {
    const docu = { price: 80.79, marketCap: null, quarterlyEps: [1.16, 1.09, 1.01, 1.01], epsFiscalYear: 2.15, epsNextQuarter: 0.53, nextQuarterEstimate: 1.2003, lastYear: null };
    expect(valuationLines(docu)).toBe(
      [
        "Earnings: 18.9× the last four quarters' EPS ($4.27) · 16.8× next quarter's EPS estimate on the reported basis × 4 ($4.80)",
        "No multiple on the Street's EPS consensus ($2.15 this fiscal year): its next quarter ($0.53) is 2.3× off the estimate for that quarter on the reported quarters' basis ($1.20), so it is likely on a different basis (GAAP and adjusted).",
      ].join("\n"),
    );
  });

  it("keeps the consensus when the same quarter agrees, through a seasonal quarter (CEG $2.77 and $2.73)", () => {
    const out = valuationLines({ ...ACN, price: 280.2, quarterlyEps: [5.06, 2.55, 2.74, 2.3], epsFiscalYear: 12.7, epsNextQuarter: 2.77, nextQuarterEstimate: 2.7303 });
    expect(out).toContain("22.1× this fiscal year's EPS consensus ($12.70) · 25.7× next quarter's EPS estimate on the reported basis × 4 ($10.92)");
    expect(out).not.toContain("No multiple");
  });

  it("keeps the multiple and prints both figures when the same quarter differs by 10% to 50% (CRM $2.41 and $3.47)", () => {
    const out = valuationLines({ ...ACN, price: 230, quarterlyEps: [5.9, 3.5, 3.3, 3.1], epsFiscalYear: 12.82, epsNextQuarter: 2.41, nextQuarterEstimate: 3.47 });
    expect(out).toContain("this fiscal year's EPS consensus ($12.82)");
    expect(out).toContain("The Street's next quarter ($2.41) and the estimate on the reported quarters' basis ($3.47) differ by 44%: the consensus may be on a different basis.");
    expect(valuationLines({ ...ACN, nextQuarterEstimate: 3.99 })).not.toContain("differ by");
  });

  it("with no estimate on the reported basis, a consensus 3× off the last reported quarter gets no multiple (IOT 2026-11-25)", () => {
    const iot = { price: 38.14, marketCap: null, quarterlyEps: [0.2, 0.17, 0.18, 0.15], epsFiscalYear: 0.13, epsNextQuarter: 0.03, lastYear: null };
    expect(valuationLines(iot)).toBe(
      [
        "Earnings: 54.5× the last four quarters' EPS ($0.70)",
        "No multiple on the Street's EPS consensus ($0.13 this fiscal year): its next quarter ($0.03) is 6.7× off the last reported quarter ($0.20), so it is likely on a different basis (GAAP and adjusted).",
      ].join("\n"),
    );
    expect(valuationLines({ ...ACN, price: 280.2, quarterlyEps: [5.06, 2.55, 2.74, 2.3], epsFiscalYear: 12.7, epsNextQuarter: 2.77 })).not.toContain("No multiple");
  });

  it("works out nothing on the figures of a company that reports in another currency (ASML in euros)", () => {
    const asml = { price: 1303.61, marketCap: 1303.61 * 393e6, quarterlyEps: [9.6, 8.7, 8.4, 8.3], epsFiscalYear: 46.51, epsNextQuarter: 17.22, nextQuarterEstimate: 15.17, reportingCurrency: "EUR", lastYear: { year: "2025", revenue: 32_700e6, freeCashFlow: 11_000e6 } };
    expect(valuationLines(asml)).toBe(
      [
        "Earnings: 28.0× this fiscal year's EPS consensus ($46.51) · 18.9× next quarter's EPS consensus × 4 ($68.88)",
        "It reports in EUR and the price is in dollars, so no multiple is worked out on its reported figures (its quarters, its sales, its cash flow); the Street's consensus is in dollars.",
      ].join("\n"),
    );
    expect(valuationLines({ ...ACN, reportingCurrency: "USD" })).toBe(valuationLines(ACN));
  });

  it("is nothing without a price", () => {
    expect(valuationLines({ ...ACN, price: null })).toBeNull();
  });
});
