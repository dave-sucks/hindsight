/**
 * screens.test.ts — the deterministic candidate screens (DAV-255),
 * replayed from real charts and calendar rows:
 *
 *   HPE 2026-09-03 print: EPS +18% — and the stock gapped DOWN 8.2% on
 *     4.0× volume. A beat the market sold; the PEAD screen must reject it.
 *   DOCU 2026-09-04 print: EPS +4.7% — under the 5% bar; rejected.
 *   HPE 2026-09-15 chart: uptrend, +12.5 pts vs SPY over 3M, 2.8% above
 *     the rising 20-day, 1.33× volume — a pullback candidate.
 */
import { screenPead, screenPullback, screenEpisodicPivot, screenBaseBreakout, runScreen } from "./screens";
import type { PriceStructure } from "@/lib/market-data/price-structure";
import type { EarningsReport } from "@/lib/agent/triggers/earnings";

const ma = (value: number, slope: "RISING" | "FALLING" | "FLAT", pctFromPrice: number) => ({ value, slope, pctFromPrice });

/** HPE's chart as the writer saw it on 2026-09-15 (260 sessions through 09-14). */
const HPE: PriceStructure = {
  asOf: "2026-09-14",
  bars: 260,
  price: 55.99,
  priceIsLive: true,
  lastClose: 55.41,
  sma: { d20: ma(54.48, "RISING", 2.8), d50: ma(51.39, "RISING", 8.9), d150: ma(37.94, "RISING", 47.6), d200: ma(34.18, "RISING", 63.8) },
  ema: { d10: 55.88, d21: 54.64 },
  rsi14: 52.1,
  atr14: { dollars: 3.75, pct: 6.7 },
  adr20Pct: 5.8,
  range: { high20: 62.15, low20: 45.7, high52w: 64.25, low52w: 19.84, pctBelow52wHigh: 12.9, pctAbove52wLow: 182.2 },
  swings: { lastHigh: { price: 55.78, date: "2026-08-27" }, lastLow: { price: 45.7, date: "2026-09-03" } },
  base: null,
  volume: { lastVsAvg20: 1.33, avg20: 24_417_299, avgDollarVolume50: 1.05e9, upDownRatio20: 1.13 },
  gaps: [
    { date: "2026-09-14", direction: "DOWN", pct: -10.4, volumeRatio: 1.3, low: 55.16, mid: 56.18, high: 57.2 },
    { date: "2026-09-03", direction: "DOWN", pct: -8.2, volumeRatio: 4.0, low: 45.7, mid: 50.29, high: 54.88 },
  ],
  relativeStrength: { vsSpy: { m1: -5.2, m3: 12.5, m6: 141.9 }, vsSector: { etf: "XLK", m1: -4.0, m3: 15.3, m6: 122.1 } },
  fib: null,
  trendTemplate: { passed: 8, of: 8, failing: [] },
  verdict: "UPTREND",
  suggested: { trendStrength: null, relativeStrength: null },
} as unknown as PriceStructure;

const HPE_REPORT: EarningsReport = {
  symbol: "HPE", reportDate: "2026-09-02", hour: "amc", epsActual: 1.11, epsEstimate: 0.94, surprisePct: 18.0,
  revenueActual: 12.21e9, revenueEstimate: 12.0e9, quarter: 3, year: 2026,
};
const DOCU_REPORT: EarningsReport = {
  symbol: "DOCU", reportDate: "2026-09-04", hour: "amc", epsActual: 1.16, epsEstimate: 1.11, surprisePct: 4.7,
  revenueActual: null, revenueEstimate: null, quarter: 3, year: 2026,
};

describe("screenPead", () => {
  it("HPE 09-03: a beat the market sold is rejected, with the gap named", () => {
    const r = screenPead([{ ticker: "HPE", structure: HPE, report: HPE_REPORT, daysSinceReport: 1 }]);
    expect(r.passed).toEqual([]);
    expect(r.rejected[0].reason).toBe("a beat the market sold: gapped -8.2% on 2026-09-03 on 4.0× volume");
  });
  it("DOCU 09-04: a 4.7% surprise is under the bar", () => {
    const r = screenPead([{ ticker: "DOCU", structure: HPE, report: DOCU_REPORT, daysSinceReport: 1 }]);
    expect(r.rejected[0].reason).toBe("EPS surprise +4.7% is under the 5% bar");
  });
  it("past day 3 the drift entry is gone", () => {
    const up = { ...HPE, gaps: [{ date: "2026-09-03", direction: "UP", pct: 6.1, volumeRatio: 3.2, low: 52, mid: 54, high: 56 }] } as PriceStructure;
    const r = screenPead([{ ticker: "HPE", structure: up, report: HPE_REPORT, daysSinceReport: 13 }]);
    expect(r.rejected[0].reason).toBe("reported 13 days ago — the drift entry is days 1–3");
  });
  it("a clean beat that gapped up on volume and held, on day 2, passes with the numbers", () => {
    const up = { ...HPE, price: 55.5, gaps: [{ date: "2026-09-03", direction: "UP", pct: 6.1, volumeRatio: 3.2, low: 52, mid: 54, high: 56 }] } as PriceStructure;
    const r = screenPead([{ ticker: "HPE", structure: up, report: HPE_REPORT, daysSinceReport: 2 }]);
    expect(r.passed).toHaveLength(1);
    expect(r.passed[0].screenRow).toBe(
      "reported 2026-09-02; EPS +18.0% vs the street; revenue +1.8%; gapped +6.1% on 3.2× volume, held (low $52.00, mid $54.00); price $55.50; ATR $3.75",
    );
  });
});

describe("screenPullback", () => {
  it("HPE 09-15: 2.8% above the rising 20-day in an uptrend beating SPY — a candidate, with the numbers", () => {
    const r = screenPullback([{ ticker: "HPE", structure: HPE }]);
    expect(r.passed).toHaveLength(1);
    expect(r.passed[0].screenRow).toBe(
      "+2.8% from the rising 20-day $54.48; Trend Template 8/8; vs SPY 3M +12.5%; last session 1.33× volume; price $55.99; ATR $3.75",
    );
  });
  it("a downtrend or a laggard is out, with the reason", () => {
    expect(screenPullback([{ ticker: "X", structure: { ...HPE, verdict: "DOWNTREND" } as PriceStructure }]).rejected[0].reason).toBe("not in an uptrend (DOWNTREND)");
    expect(
      screenPullback([{ ticker: "X", structure: { ...HPE, relativeStrength: { vsSpy: { m1: 0, m3: -4, m6: 0 }, vsSector: null } } as PriceStructure }]).rejected[0].reason,
    ).toBe("lagging SPY over 3 months (-4.0%)");
  });
});

describe("screenEpisodicPivot and screenBaseBreakout", () => {
  it("HPE has no gap up: not an episodic pivot; and no base: not a breakout", () => {
    expect(screenEpisodicPivot([{ ticker: "HPE", structure: HPE }]).rejected[0].reason).toBe("no gap up in the last 10 sessions");
    expect(screenBaseBreakout([{ ticker: "HPE", structure: HPE }]).rejected[0].reason).toContain("no base");
  });
  it("a tight base under its pivot passes with the distance to the pivot", () => {
    const based = { ...HPE, price: 60, base: { lengthBars: 24, startDate: "2026-08-10", endDate: "2026-09-12", pivot: 62.15, low: 54, depthPct: 13.1, lastContractionPct: 4.2, brokenOut: false } } as PriceStructure;
    const r = runScreen("BASE_BREAKOUT", [{ ticker: "HPE", structure: based }]);
    expect(r.passed[0].screenRow).toContain("pivot $62.15 (+3.6% away)");
  });
  it("no chart is a named rejection, never a crash", () => {
    expect(runScreen("MA_PULLBACK", [{ ticker: "ZZZZ", structure: null }]).rejected[0].reason).toBe("no chart");
  });
});
