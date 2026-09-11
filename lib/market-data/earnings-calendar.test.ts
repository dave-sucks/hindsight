/**
 * The pure parts of the earnings page: which calendar rows a person sees,
 * and in what order. The vendor calls are the same ones the trigger
 * evaluator's tests already cover.
 */

import { compareRows, isNotable } from "./earnings-calendar";
import type { EarningsReport } from "@/lib/agent/triggers/earnings";

jest.mock("@/lib/agent/research-helpers", () => ({ finnhub: jest.fn() }));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn() }));
jest.mock("@/lib/actions/stock-info", () => ({ getStockInfo: jest.fn() }));

function row(p: Partial<EarningsReport>): EarningsReport {
  return {
    symbol: "X",
    reportDate: "2026-09-10",
    hour: "amc",
    epsActual: null,
    epsEstimate: null,
    surprisePct: null,
    revenueActual: null,
    revenueEstimate: null,
    quarter: null,
    year: null,
    ...p,
  };
}

describe("isNotable", () => {
  const covered = new Set(["MU"]);
  it("keeps a row the street forecasts", () => {
    expect(isNotable(row({ symbol: "ORCL", epsEstimate: 1.2 }), covered)).toBe(true);
    expect(isNotable(row({ symbol: "ORCL", revenueEstimate: 1e9 }), covered)).toBe(true);
  });
  it("drops an unforecast micro-cap", () => {
    expect(isNotable(row({ symbol: "BBN" }), covered)).toBe(false);
  });
  it("always keeps a name on the book", () => {
    expect(isNotable(row({ symbol: "MU" }), covered)).toBe(true);
  });
});

describe("compareRows", () => {
  const covered = new Set(["MU"]);
  it("puts our names first, then real companies by surprise, then micro-caps", () => {
    const rows = [
      row({ symbol: "BIG", surprisePct: 1, revenueEstimate: 50e9 }),
      row({ symbol: "MISS", surprisePct: -20, revenueEstimate: 1e9 }),
      // A one-cent estimate: "−194%" on a $20M company must not outrank Oracle.
      row({ symbol: "TINY", surprisePct: -194, revenueEstimate: 2e7 }),
      row({ symbol: "MU", surprisePct: null, revenueEstimate: 12e9 }),
      row({ symbol: "BEAT", surprisePct: 18, revenueEstimate: 2e9 }),
    ];
    expect(rows.sort(compareRows(covered)).map((r) => r.symbol)).toEqual([
      "MU",
      "MISS",
      "BEAT",
      "BIG",
      "TINY",
    ]);
  });
});
