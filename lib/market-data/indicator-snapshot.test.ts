/**
 * indicator-snapshot.test.ts — the stored chart numbers match the chart,
 * and a gap's age is counted from today (yesterday = 1 session ago).
 */

import { computePriceStructure, type DailyBar } from "./price-structure";
import {
  liveRsi,
  movePctOverSessions,
  parseIndicatorSnapshot,
  toIndicatorSnapshot,
  volumeRatio,
  SNAPSHOT_CLOSES,
} from "./indicator-snapshot";

const DAY0 = Date.UTC(2025, 0, 1);
const dateAt = (i: number) => new Date(DAY0 + i * 86400_000).toISOString().slice(0, 10);
const bars: DailyBar[] = Array.from({ length: 260 }, (_, i) => {
  const c = 50 * Math.pow(1.003, i);
  return { date: dateAt(i), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 };
});
// A 9% gap two sessions before the last bar, on 4× volume.
bars[257] = { ...bars[257], open: bars[256].close * 1.09, high: bars[256].close * 1.11, volume: 4_000_000 };

const structure = computePriceStructure({ bars, spyBars: bars.map((b) => ({ ...b, close: 400 })) })!;
const snap = toIndicatorSnapshot(structure, bars);

describe("toIndicatorSnapshot", () => {
  it("carries the averages and highs from the chart", () => {
    expect(snap.sma[50]).toBe(structure.sma.d50!.value);
    expect(snap.sma[200]).toBe(structure.sma.d200!.value);
    expect(snap.high52w).toBe(structure.range.high52w);
    expect(snap.asOf).toBe(bars[259].date);
  });

  it("keeps the last 60 closes, oldest first", () => {
    expect(snap.closes).toHaveLength(SNAPSHOT_CLOSES);
    expect(snap.closes[SNAPSHOT_CLOSES - 1]).toBe(bars[259].close);
  });

  it("counts a gap's age from today: the gap on bar 257 is 3 sessions ago", () => {
    expect(snap.gaps).toHaveLength(1);
    expect(snap.gaps[0].sessionsAgo).toBe(3);
    expect(snap.gaps[0].pct).toBeCloseTo(9, 0);
  });

  it("round-trips through the Json column", () => {
    expect(parseIndicatorSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
    expect(parseIndicatorSnapshot({ nope: 1 })).toBeNull();
  });
});

describe("the evaluator's reads", () => {
  it("move over N sessions is measured from the close N back", () => {
    const base = snap.closes[SNAPSHOT_CLOSES - 5];
    expect(movePctOverSessions(snap, base * 1.1, 5)).toBeCloseTo(10, 5);
  });
  it("volume ratio is today ÷ the 20-day average", () => {
    expect(volumeRatio(snap, snap.volumeAvg20! * 2)).toBeCloseTo(2, 5);
    expect(volumeRatio(snap, null)).toBeNull();
  });
  it("RSI takes the live price as today's close", () => {
    const up = liveRsi(snap, snap.closes[SNAPSHOT_CLOSES - 1] * 1.05, 14)!;
    const down = liveRsi(snap, snap.closes[SNAPSHOT_CLOSES - 1] * 0.8, 14)!;
    expect(up).toBeGreaterThan(down);
  });
});
