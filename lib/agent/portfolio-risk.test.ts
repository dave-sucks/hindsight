/**
 * portfolio-risk.test.ts — heat, the industry count, and the regime reading.
 */

import { heatLine, industryLine, openRisk } from "./portfolio-risk";
import { computeRegime } from "./regime";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

const holdings = [
  { symbol: "MU", direction: "LONG", qty: 13, price: 1000, stop: 969, industry: "Semiconductors" },
  { symbol: "NVDA", direction: "LONG", qty: 33, price: 230, stop: 200.15, industry: "Semiconductors" },
  { symbol: "SMMT", direction: "LONG", qty: 450, price: 17, stop: 16.8, industry: "Biotechnology" },
  { symbol: "XYZ", direction: "LONG", qty: 10, price: 50, stop: null, industry: null },
];

describe("openRisk", () => {
  const r = openRisk(holdings, 100_000);
  it("sums shares × distance to the stop", () => {
    // MU 13×31 = 403; NVDA 33×29.85 = 985.05; SMMT 450×0.2 = 90.
    expect(r.riskDollars).toBeCloseTo(403 + 985.05 + 90, 2);
    expect(r.riskPct).toBeCloseTo(1.478, 2);
    expect(r.perName[0].symbol).toBe("NVDA");
  });
  it("names a holding with no stop instead of guessing", () => {
    expect(r.unstopped).toEqual(["XYZ"]);
  });
  it("a stop above the price (a locked gain) is zero risk, not negative", () => {
    expect(openRisk([{ symbol: "A", direction: "LONG", qty: 10, price: 90, stop: 100, industry: null }], 10_000).riskDollars).toBe(0);
  });
});

describe("heatLine / industryLine", () => {
  const r = openRisk(holdings, 100_000);
  it("reports open risk after the buy against the 6% cap", () => {
    expect(heatLine(r, 100_000, 5_000)).toMatch(/^Open risk after this buy: 6\.5% of equity \(cap 6%\) — OVER the cap; largest: NVDA \$985/);
    expect(heatLine(r, 100_000)).toMatch(/no stop, not counted: XYZ/);
  });
  it("flags a third name in one industry", () => {
    expect(industryLine(r, "Semiconductors", "AMD")).toBe(
      "This would be name 3 in Semiconductors (MU, NVDA) — the playbook's limit is 2; they move as one bet.",
    );
    expect(industryLine(r, "Biotechnology", "XBIO")).toBeNull();
    expect(industryLine(r, "Semiconductors", "MU")).toBeNull();
  });
});

describe("computeRegime", () => {
  const snap = (close: number, s50: number, s200: number): IndicatorSnapshot =>
    ({
      asOf: "2026-09-10",
      sma: { 20: null, 50: s50, 150: null, 200: s200 },
      high20: 0, low20: 0, high52w: 0, low52w: 0,
      volumeAvg20: null,
      closes: [close],
      rsVsSpy: { "1M": null, "3M": null, "6M": null },
      gaps: [],
      atr14: null,
    }) as IndicatorSnapshot;

  it("RISK_ON above both averages", () => {
    expect(computeRegime(snap(600, 580, 550), [])!.regime).toBe("RISK_ON");
  });
  it("CAUTION under the 50-day, above the 200-day", () => {
    const r = computeRegime(snap(570, 580, 550), [])!;
    expect(r.regime).toBe("CAUTION");
    expect(r.line).toContain("half size on new entries");
  });
  it("RISK_OFF under the 200-day", () => {
    expect(computeRegime(snap(540, 580, 550), [])!.regime).toBe("RISK_OFF");
  });
  it("reports breadth and flags thin leadership in RISK_ON", () => {
    const book = [snap(10, 9, 8), snap(10, 11, 8), snap(10, 12, 8)];
    const r = computeRegime(snap(600, 580, 550), book)!;
    expect(r.breadthPct).toBe(33);
    expect(r.line).toContain("33% of the book is above its 50-day (under 60% — thin leadership)");
  });
  it("null without a SPY snapshot", () => {
    expect(computeRegime(null, [])).toBeNull();
  });
});
