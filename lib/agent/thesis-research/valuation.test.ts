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

  it("puts no multiple on a consensus far off the reported quarters, and says why (IOT 2026-11-25)", () => {
    const iot = { price: 38.14, marketCap: null, quarterlyEps: [0.2, 0.17, 0.18, 0.15], epsFiscalYear: 0.13, epsNextQuarter: 0.03, lastYear: null };
    expect(valuationLines(iot)).toBe(
      [
        "Earnings: 54.5× the last four quarters' EPS ($0.70)",
        "No multiple on the Street's EPS consensus: its next quarter ($0.03) is 6.7× off the last reported quarter ($0.20), so the two are likely on different bases (GAAP and adjusted).",
      ].join("\n"),
    );
  });

  it("keeps the consensus multiples through a seasonal quarter (CEG $5.06 to $2.77)", () => {
    const out = valuationLines({ ...ACN, price: 280.2, quarterlyEps: [5.06, 2.55, 2.74, 2.3], epsFiscalYear: 12.7, epsNextQuarter: 2.77 });
    expect(out).toContain("22.1× this fiscal year's EPS consensus ($12.70)");
    expect(out).not.toContain("No multiple");
  });

  it("is nothing without a price", () => {
    expect(valuationLines({ ...ACN, price: null })).toBeNull();
  });
});
