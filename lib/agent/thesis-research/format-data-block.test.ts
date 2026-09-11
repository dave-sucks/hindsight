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

  it("offers computed composite scores the writer may override", () => {
    expect(out).toContain("Computed composite scores from this chart — trendStrength");
    expect(out).toContain("if you change one, say why in its note");
  });

  it("labels fib levels as candidates, never a reason alone", () => {
    expect(out).toContain("Retracements of the last up-leg");
    expect(out).toContain("candidates only");
  });

  it("says which feed the volume came from", () => {
    expect(out).toContain("consolidated volume");
    expect(formatDataBlock(inputs({ ...chart, volumeFeed: "iex" }))).toContain("IEX-only volume");
  });

  it("still tells the writer an entry cannot be today's price (PR 4 changes this, not PR 1)", () => {
    expect(out).toMatch(/price the stock has NOT reached/i);
    expect(out).toMatch(/Today's price is not an entry/i);
  });

  it("says the chart is unavailable when there are no bars", () => {
    const none = formatDataBlock(inputs(null));
    expect(none).toContain("## Price structure");
    expect(none).toContain("(chart unavailable — no daily bars)");
    expect(none).toContain("Current: $35.16");
  });
});
