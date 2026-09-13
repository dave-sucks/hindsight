/**
 * review-fixes.replay.test.ts — hole 6 replayed from production rows.
 *
 * Checked 2026-09-13 before writing: the live book has zero close-basis
 * levels, zero 5D/20D buys, no chart-trigger fire and no TRADE-horizon buy
 * confirmation since #628 — holes 1–5, 7 and 8 have not been hit yet, so
 * there is no production input to replay for them (their tests use MSFT's
 * real 09-10 figures). The one chart trigger on the book is GD's "reclaims
 * the 50-day" buy. Below are that trigger and GD's stored snapshot
 * (TickerIndicators asOf 2026-09-10), verbatim.
 */

import { describeChartFire } from "./chart-context";
import { shouldFire, type EvaluationContext } from "./evaluate";
import type { Trigger } from "./types";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

const GD_TRIGGER: Trigger = {
  id: "973da0b6-b16a-43d0-8b57-6b6b65af9df7",
  action: "ENTER",
  source: "AGENT",
  predicate: { kind: "VS_SMA", period: 50, direction: "ABOVE" },
  rationale:
    "Buy only when GD reclaims the 50-day average, which would show the pullback has ended and the market is again underwriting the submarine-margin inflection story.",
  cooldownDays: 1,
};

const GD_SNAPSHOT: IndicatorSnapshot = {
  sma: { 20: 376.57, 50: 378.22, 150: 357.01, 200: 354.73 },
  asOf: "2026-09-10",
  gaps: [],
  atr14: 6.98,
  low20: 352.19,
  closes: [364.11,362.83,350.01,343.36,350.34,344.32,344.7,346.71,348.07,354.24,362.86,373.54,376.88,374.64,374.31,374.6,375.06,372.78,369.5,365.63,368.82,368.58,370.6,367.73,373.16,381.79,386.75,389.14,393.19,380.96,382.2,383.42,382.43,385.76,384.08,386.92,392.05,395.97,391.89,394.21,392.96,395.78,391.14,393.48,392.34,386.07,384.29,383.77,376.58,382.02,380.06,379.32,371.35,369.41,364.07,365.87,359.39,356.58,352.67,354.25],
  high20: 396.92,
  low52w: 306.77,
  high52w: 400,
  rsVsSpy: { "1M": -8, "3M": -0.6, "6M": -11.9 },
  volumeAvg20: 920530,
};

const ctx = (price: number, prevClose: number): EvaluationContext => ({
  thesis: { createdAt: new Date("2026-06-12T15:16:15Z"), direction: "LONG" },
  now: new Date("2026-09-14T15:00:00Z"),
  latestQuote: { price, changePct: ((price - prevClose) / prevClose) * 100, prevClose },
  indicators: GD_SNAPSHOT,
});

describe("GD's real 50-day reclaim buy, on GD's real snapshot", () => {
  it("does not fire at the real close — $354.25 is under the $378.22 50-day", () => {
    expect(shouldFire(GD_TRIGGER, ctx(354.25, 352.67)).fires).toBe(false);
  });

  it("fires on the day it reclaims, and the fire carries the numbers (hole 6)", () => {
    expect(shouldFire(GD_TRIGGER, ctx(380, 354.25)).fires).toBe(true);
    // On main the audit row and the tactical kickoff carried no figures for
    // a chart fire — the next agent re-fetched the 50-day.
    expect(describeChartFire(GD_TRIGGER.predicate, GD_SNAPSHOT, 380)).toBe(
      "50-day $378.22; price $380.00 (+0.5% from it)",
    );
  });
});
