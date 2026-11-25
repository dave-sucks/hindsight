/**
 * format-data-block.test.ts — the writer must be given the chart, in dollars.
 *
 * The bug this pins (2026-09-02): `sma20` and `sma50` were pulled into the
 * data block and never printed — only the PERCENT distance to them was. A
 * writer asked to name an entry, a target and a stop, and to "cite the
 * level," had one dollar figure: today's price. It used it, every time. TOST
 * entry $35.15 against a $35.16 tape; ISRG $401.23 against $401.29.
 *
 * DAV-243 widened the fix from two averages to the whole chart: every level
 * a setup anchors to (200-day, ATR, swing low, base pivot, gap-day low,
 * relative strength) is printed with its dollar value.
 */

import { formatDataBlock } from "./format-data-block";
import { computePriceStructure, type DailyBar } from "@/lib/market-data/price-structure";

const DAY0 = Date.UTC(2025, 0, 1);
const dateAt = (i: number) => new Date(DAY0 + i * 86400_000).toISOString().slice(0, 10);

function barsFrom(closes: number[]): DailyBar[] {
  return closes.map((c, i) => ({
    date: dateAt(i),
    open: i === 0 ? c : closes[i - 1],
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1_000_000,
  }));
}

// A year of advance, then a 30-session sideways base, then a gap up.
const climb = Array.from({ length: 220 }, (_, i) => 20 * Math.pow(1.004, i));
const top = climb[climb.length - 1];
const base = Array.from({ length: 30 }, (_, i) => top * (i % 2 === 0 ? 1.03 : 0.97));
const bars = barsFrom([...climb, ...base]);
const last = bars.length - 1;
bars[last] = { ...bars[last], open: bars[last - 1].close * 1.05, high: bars[last - 1].close * 1.07, volume: 3_000_000 };
const spy = barsFrom(Array(bars.length).fill(400));
const chart = computePriceStructure({ bars, spyBars: spy, sectorBars: spy, sectorEtf: "XLK" })!;

function inputs(technicals: unknown) {
  return {
    ticker: "tost",
    pulledAt: new Date("2026-09-02T13:00:00.000Z"),
    stockData: {
      companyName: "Toast, Inc.",
      quote: { current: 35.16, changePercent: 0.4, week52Low: 24.5, week52High: 44.0 },
      technicals,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    financials: null,
    analystCoverage: null,
    insider: null,
    earningsHistory: null,
    peers: null,
    filings: null,
  };
}

describe("formatDataBlock — the chart, in dollars", () => {
  const out = formatDataBlock(inputs({ ...chart, volumeFeed: "sip" }));

  it("prints every moving average in dollars with its slope", () => {
    expect(out).toContain(`200-day $${chart.sma.d200!.value.toFixed(2)} (rising`);
    expect(out).toContain(`50-day $${chart.sma.d50!.value.toFixed(2)}`);
    expect(out).toContain(`20-day $${chart.sma.d20!.value.toFixed(2)}`);
  });

  it("prints ATR, the swing points and the base pivot in dollars", () => {
    expect(out).toContain(`ATR(14) $${chart.atr14!.dollars.toFixed(2)}`);
    expect(out).toContain(`last swing low $${chart.swings.lastLow!.price.toFixed(2)}`);
    expect(out).toContain(`pivot $${chart.base!.pivot.toFixed(2)}`);
  });

  it("prints the gap with its gap-day low", () => {
    const g = chart.gaps[0];
    expect(out).toContain(`gap-day low $${g.low.toFixed(2)}`);
    expect(out).toMatch(/UP \+5\.0%/);
  });

  it("prints relative strength vs SPY and the sector ETF", () => {
    expect(out).toMatch(/vs SPY: 1M [+-]\d/);
    expect(out).toMatch(/vs XLK: 1M/);
  });

  it("labels fib levels as candidates, never a reason alone", () => {
    expect(out).toContain("Retracements of the last up-leg");
    expect(out).toContain("candidates only");
  });

  it("says which feed the volume came from", () => {
    expect(out).toContain("consolidated volume");
    expect(formatDataBlock(inputs({ ...chart, volumeFeed: "iex" }))).toContain("IEX-only volume");
  });

  it("tells the writer the chart numbers are where its playbook's prices come from", () => {
    expect(out).toContain("These chart numbers are where the prices in your playbook's triggers come from.)");
    expect(out).not.toContain("few cents");
    expect(out).not.toMatch(/Today's price is not an entry/i);
  });

  it("says the chart is unavailable when there are no bars", () => {
    const none = formatDataBlock(inputs(null));
    expect(none).toContain("## Price structure");
    expect(none).toContain("(chart unavailable — no daily bars)");
    expect(none).toContain("Current: $35.16");
  });
});

describe("formatDataBlock — the last report's date (HPE 2026-09-15)", () => {
  // The per-quarter table carries no report dates, so the writer could not
  // tell that HPE's print was 13 days old and wrote it as a day-1–3 drift.
  it("says when the last report was and how many days ago", () => {
    const out = formatDataBlock({ ...inputs(null), lastReport: { date: "2026-09-02", daysAgo: 13 } });
    expect(out).toContain("Last report: 2026-09-02, 13 days ago (the report day is 0 — a drift entry is days 1–3).");
  });
  it("says none, or that the call failed — never a failure shown as none", () => {
    expect(formatDataBlock({ ...inputs(null), lastReport: null })).toContain("Last report: none on the calendar in the last 100 days.");
    expect(formatDataBlock({ ...inputs(null), lastReport: { failed: true } })).toContain("Last report: unknown — the calendar call failed");
  });
  it("prints nothing about it when the caller didn't ask", () => {
    expect(formatDataBlock(inputs(null))).not.toContain("Last report:");
  });
});

describe("formatDataBlock — the valuation at today's price (blind test 2026-11-24)", () => {
  // The block carried two unlabeled P/Es at Finnhub's price (CEG 43.1 and 22.9)
  // and no forward one; the Writer divided for itself (ACN 16.7×, really 17.0×).
  const out = formatDataBlock({
    ...inputs(null),
    stockData: { ticker: "ACN", quote: { current: 247.7, changePercent: -1.1, marketCap: 247.7 * 590.74e6 } } as never,
    earningsHistory: { history: [3.29, 3.8, 2.93, 3.94].map((actual, i) => ({ quarter: `Q${4 - i}`, reportedAt: null, revenue: { actual: null, estimate: null, surprisePct: null }, eps: { actual, estimate: actual, surprisePct: 0 }, outcome: "INLINE" as const })), beats: 0, misses: 0, beatRatePct: null },
    analystCoverage: { consensus: null, priceTargets: null, street: { epsFiscalYear: 14.68, epsNextQuarter: 3.9 } as never },
  });
  it("prints each multiple with what it divides by", () => {
    expect(out).toContain("## Valuation at $247.70\n\nEarnings: 17.7× the last four quarters' EPS ($13.96) · 16.9× this fiscal year's EPS consensus ($14.68)");
  });
  it("prints no P/E of Finnhub's in the snapshot", () => {
    expect(out).not.toMatch(/P\/E/);
  });
});
