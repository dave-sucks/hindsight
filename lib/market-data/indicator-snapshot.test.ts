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
  volumeRatio, normalVolumeShare,
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
  describe("volume ratio", () => {
    const AFTER_THE_CLOSE = new Date("2026-11-23T21:20:00Z"); // 16:20 ET
    it("after the close it is the day's volume ÷ the 20-day average", () => {
      expect(volumeRatio(snap, snap.volumeAvg20! * 2, AFTER_THE_CLOSE)).toBeCloseTo(2, 5);
      expect(volumeRatio(snap, null, AFTER_THE_CLOSE)).toBeNull();
    });
    it("before the open, on a weekend and with no clock it is the plain ratio", () => {
      for (const now of [new Date("2026-11-23T13:00:00Z"), new Date("2026-11-22T16:00:00Z"), undefined]) {
        expect(normalVolumeShare(now)).toBe(1);
      }
    });
    it("in the session it is against the normal volume by this time of day", () => {
      // Half a normal day's volume by 12:00 ET (minute 150, when 30.95% has normally traded) is 1.6× normal.
      expect(volumeRatio(snap, snap.volumeAvg20! * 0.5, new Date("2026-11-23T17:00:00Z"))).toBeCloseTo(0.5 / 0.3095, 3);
    });
    it("holds the first half hour at the 30-minute share, so the open's swings don't read as a volume day", () => {
      expect(normalVolumeShare(new Date("2026-11-23T14:35:00Z"))).toBe(normalVolumeShare(new Date("2026-11-23T15:00:00Z")));
    });
    it("rises through the session and stops short of the closing auction", () => {
      const shares = ["15:00", "16:00", "18:00", "20:00", "20:59"].map((t) => normalVolumeShare(new Date(`2026-11-23T${t}:00Z`)));
      expect(shares).toEqual([...shares].sort((a, b) => a - b));
      expect(shares.at(-1)).toBeLessThan(0.8);
    });
    it("runs the same shape on a half day", () => {
      // The day after Thanksgiving closes at 13:00 ET: halfway through is 11:15 ET.
      expect(normalVolumeShare(new Date("2026-11-27T16:15:00Z"))).toBeCloseTo(normalVolumeShare(new Date("2026-11-23T17:45:00Z")), 3);
    });
    it("ASML at 3:39 PM on Nov 23, up 9.7%: 0.9× of a full day is 1.4× the pace", () => {
      const ratio = volumeRatio({ ...snap, volumeAvg20: 1_000_000 }, 900_000, new Date("2026-11-23T20:39:00Z"))!;
      expect(ratio).toBeGreaterThan(1.3);
      expect(ratio).toBeLessThan(1.5);
    });
  });
  it("RSI takes the live price as today's close", () => {
    const up = liveRsi(snap, snap.closes[SNAPSHOT_CLOSES - 1] * 1.05, 14)!;
    const down = liveRsi(snap, snap.closes[SNAPSHOT_CLOSES - 1] * 0.8, 14)!;
    expect(up).toBeGreaterThan(down);
  });
});
