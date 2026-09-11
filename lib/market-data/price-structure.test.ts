/**
 * price-structure.test.ts — every chart number on synthetic bars whose
 * answer is known by construction: a base we built, a gap we opened, a
 * swing we placed. If one of these moves, a writer's stop moves with it.
 */

import {
  adrPct,
  atr,
  computePriceStructure,
  detectBase,
  ema,
  lastSwings,
  lastUpLegFib,
  recentGaps,
  relativeReturns,
  rsi,
  sectorEtfFor,
  sma,
  trendTemplate,
  trendVerdict,
  type DailyBar,
} from "./price-structure";

const DAY0 = Date.UTC(2025, 0, 1);
const dateAt = (i: number) => new Date(DAY0 + i * 86400_000).toISOString().slice(0, 10);

/** Bars from closes: open = prior close, high/low ±1%, flat volume. */
function barsFrom(closes: number[], volume = 1_000_000): DailyBar[] {
  return closes.map((c, i) => ({
    date: dateAt(i),
    open: i === 0 ? c : closes[i - 1],
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume,
  }));
}

const line = (n: number, from: number, step: number) =>
  Array.from({ length: n }, (_, i) => from + i * step);

describe("averages and oscillators", () => {
  it("sma is the plain mean of the last N", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
    expect(sma([1, 2], 3)).toBeNull();
  });

  it("sma can be read as of an earlier bar (for slope)", () => {
    expect(sma([1, 2, 3, 4, 5], 2, 3)).toBe(2.5);
  });

  it("ema of a constant series is the constant", () => {
    expect(ema(Array(30).fill(50), 10)).toBeCloseTo(50);
  });

  it("ema leans toward recent values", () => {
    const e = ema([...Array(20).fill(10), ...Array(5).fill(20)], 10)!;
    const s = sma([...Array(20).fill(10), ...Array(5).fill(20)], 10)!;
    expect(e).toBeGreaterThan(10);
    expect(e).toBeLessThan(20);
    expect(s).toBe(15);
  });

  it("rsi is 100 on a straight rise and low on a straight fall", () => {
    expect(rsi(line(30, 10, 1))).toBe(100);
    expect(rsi(line(30, 50, -1))!).toBeLessThan(5);
  });

  it("atr of ±1% bars on a flat $100 stock is $2", () => {
    expect(atr(barsFrom(Array(30).fill(100)))).toBeCloseTo(2, 5);
  });

  it("adr of ±1% bars is ~2.02%", () => {
    expect(adrPct(barsFrom(Array(30).fill(100)))!).toBeCloseTo((1.01 / 0.99 - 1) * 100, 5);
  });
});

describe("swings", () => {
  it("finds the swing high and swing low we placed", () => {
    // Flat at 100, a spike to 120 at bar 20, a dip to 80 at bar 40, flat after.
    const closes = Array(60).fill(100);
    closes[20] = 120;
    closes[40] = 80;
    const bars = barsFrom(closes);
    const { lastHigh, lastLow } = lastSwings(bars);
    expect(lastHigh).toEqual({ price: 120 * 1.01, date: dateAt(20) });
    expect(lastLow).toEqual({ price: 80 * 0.99, date: dateAt(40) });
  });

  it("a low in the last 5 bars is not a swing yet", () => {
    const closes = Array(60).fill(100);
    closes[57] = 80;
    const { lastLow } = lastSwings(barsFrom(closes));
    expect(lastLow?.date).not.toBe(dateAt(57));
  });
});

describe("base", () => {
  // 60 bars climbing 50 → 108, then a 30-bar sideways base between 100 and
  // 110 (depth ≈ 10% incl. the ±1% wicks), tightening into the right side.
  const climb = line(60, 50, 1);
  const baseCloses = Array.from({ length: 30 }, (_, i) => {
    const amp = i < 15 ? 5 : i < 25 ? 3 : 1;
    return 105 + (i % 2 === 0 ? amp : -amp);
  });
  const bars = barsFrom([...climb, ...baseCloses]);

  it("finds the base, its pivot and its low", () => {
    const base = detectBase(bars, 105)!;
    expect(base).not.toBeNull();
    expect(base.lengthBars).toBeGreaterThanOrEqual(30);
    expect(base.pivot).toBeCloseTo(110 * 1.01, 1);
    expect(base.low).toBeLessThanOrEqual(100);
    expect(base.depthPct).toBeLessThanOrEqual(15);
    expect(base.brokenOut).toBe(false);
  });

  it("reads the last contraction tighter than the base", () => {
    const base = detectBase(bars, 105)!;
    expect(base.lastContractionPct).toBeLessThan(base.depthPct);
  });

  it("marks a price above the pivot as broken out", () => {
    expect(detectBase(bars, 115)!.brokenOut).toBe(true);
  });

  it("a steady climb is not a base", () => {
    // +0.4%/day for 60 days: every 20-day window spans < 15%, none is sideways.
    const grind = Array.from({ length: 60 }, (_, i) => 100 * Math.pow(1.004, i));
    expect(detectBase(barsFrom(grind), grind[59])).toBeNull();
  });

  it("a 25% range is not a base", () => {
    const wide = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 100 : 125));
    expect(detectBase(barsFrom(wide), 110)).toBeNull();
  });
});

describe("base — real bars (MSFT, SIP, 2026-07-23 → 09-10)", () => {
  // Earnings gap 07-30 (+12%, 110M shares), run to $513 by 08-10, then
  // sideways $475–$518. The base is 08-03 onward. 07-31 — the last day of
  // the run, low $449 — must not be in it (it made the base read 13% deep).
  const rows: [string, number, number, number, number, number][] = [
  ["2026-07-23", 389.96, 391.78, 377.39, 381.58, 30.5],
  ["2026-07-24", 387.05, 389.03, 380.65, 381.70, 27.7],
  ["2026-07-27", 390.08, 394.20, 387.99, 389.10, 28.0],
  ["2026-07-28", 393.16, 400.32, 391.30, 393.35, 32.4],
  ["2026-07-29", 393.40, 401.25, 388.74, 390.54, 47.3],
  ["2026-07-30", 437.90, 458.69, 432.44, 451.10, 110.3],
  ["2026-07-31", 450.00, 466.84, 449.33, 464.72, 60.9],
  ["2026-08-03", 476.13, 491.65, 475.00, 487.65, 66.9],
  ["2026-08-04", 480.90, 499.44, 479.17, 492.81, 50.6],
  ["2026-08-05", 496.36, 498.24, 485.68, 487.46, 33.5],
  ["2026-08-06", 488.55, 501.56, 488.52, 499.86, 36.5],
  ["2026-08-07", 499.21, 505.18, 498.73, 499.99, 28.9],
  ["2026-08-10", 503.44, 513.73, 502.27, 506.06, 31.3],
  ["2026-08-11", 504.33, 505.33, 499.55, 503.81, 23.1],
  ["2026-08-12", 499.99, 501.50, 491.52, 492.43, 29.1],
  ["2026-08-13", 493.26, 501.34, 493.01, 496.88, 23.1],
  ["2026-08-14", 496.36, 500.01, 493.92, 495.40, 16.3],
  ["2026-08-17", 490.14, 492.66, 478.41, 480.35, 29.8],
  ["2026-08-18", 481.54, 484.27, 477.15, 481.63, 24.2],
  ["2026-08-19", 480.06, 489.30, 479.36, 484.31, 20.0],
  ["2026-08-20", 483.30, 484.16, 479.50, 481.15, 20.1],
  ["2026-08-21", 479.88, 486.36, 478.53, 483.24, 22.6],
  ["2026-08-24", 483.20, 490.61, 481.86, 487.31, 17.4],
  ["2026-08-25", 485.44, 492.44, 484.30, 491.71, 19.6],
  ["2026-08-26", 487.85, 497.40, 487.31, 496.37, 20.8],
  ["2026-08-27", 494.88, 506.48, 490.08, 505.06, 28.8],
  ["2026-08-28", 505.33, 517.78, 504.87, 513.53, 29.3],
  ["2026-08-31", 510.38, 512.19, 506.39, 507.29, 27.3],
  ["2026-09-01", 497.52, 505.97, 496.78, 501.02, 21.1],
  ["2026-09-02", 499.85, 500.27, 493.81, 496.82, 15.4],
  ["2026-09-03", 501.66, 515.65, 500.80, 510.12, 24.2],
  ["2026-09-04", 510.00, 511.00, 499.36, 499.70, 18.2],
  ["2026-09-08", 493.01, 495.19, 490.15, 493.95, 19.0],
  ["2026-09-09", 493.07, 494.39, 489.80, 491.65, 13.0],
  ["2026-09-10", 488.32, 494.52, 486.00, 492.44, 16.1],
  ];
  const msft: DailyBar[] = rows.map(([date, open, high, low, close, m]) => ({
    date, open, high, low, close, volume: m * 1e6,
  }));

  it("starts the base after the run-up, not on its last day", () => {
    const base = detectBase(msft, 492.44)!;
    expect(base.startDate).toBe("2026-08-03");
    expect(base.low).toBe(475);
    expect(base.pivot).toBe(517.78);
    expect(base.depthPct).toBeCloseTo(8.3, 1);
  });

  it("finds the earnings gap as a 3%+ UP gap when it is recent", () => {
    const g = recentGaps(msft.slice(0, 8)).find((x) => x.date === "2026-07-30")!;
    expect(g.direction).toBe("UP");
    expect(g.pct).toBeCloseTo(12.1, 1);
    expect(g.low).toBe(432.44);
    // Five sessions before it is too few for an honest volume average.
    expect(g.volumeRatio).toBeNull();
  });

  it("reads 08-18 as the last swing low and 08-28 as the last swing high", () => {
    const { lastHigh, lastLow } = lastSwings(msft);
    expect(lastLow).toEqual({ price: 477.15, date: "2026-08-18" });
    expect(lastHigh).toEqual({ price: 517.78, date: "2026-08-28" });
  });
});

describe("gaps", () => {
  it("finds the gap we opened, with its size, volume and range", () => {
    const closes = Array(40).fill(100);
    const bars = barsFrom(closes);
    // Bar 35 opens at 106 on 3x volume and closes 108.
    bars[35] = { date: dateAt(35), open: 106, high: 110, low: 105, close: 108, volume: 3_000_000 };
    bars[36] = { ...bars[36], open: 108 };
    const gaps = recentGaps(bars);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      date: dateAt(35),
      direction: "UP",
      pct: 6,
      volumeRatio: 3,
      low: 105,
      mid: 107.5,
      high: 110,
    });
  });

  it("ignores moves under 3% and gaps older than 10 sessions", () => {
    const bars = barsFrom(Array(40).fill(100));
    bars[10] = { ...bars[10], open: 110 };
    bars[38] = { ...bars[38], open: 102 };
    expect(recentGaps(bars)).toEqual([]);
  });

  it("reports gap-downs as DOWN", () => {
    const bars = barsFrom(Array(40).fill(100));
    bars[39] = { date: dateAt(39), open: 90, high: 92, low: 88, close: 91, volume: 1_000_000 };
    expect(recentGaps(bars)[0]).toMatchObject({ direction: "DOWN", pct: -10 });
  });
});

describe("relative strength", () => {
  it("is the stock's return minus the benchmark's, by date", () => {
    // Stock doubles over 126 bars; SPY rises 10%.
    const stock = barsFrom(Array.from({ length: 130 }, (_, i) => (i < 3 ? 50 : 50 + ((i - 3) / 126) * 50)));
    const spy = barsFrom(Array.from({ length: 130 }, (_, i) => (i < 3 ? 100 : 100 + ((i - 3) / 126) * 10)));
    const rs = relativeReturns(stock, spy)!;
    expect(rs.m6).toBeCloseTo(100 - 10, 0);
    expect(rs.m1!).toBeGreaterThan(0);
  });

  it("aligns by date when the benchmark is missing days", () => {
    const stock = barsFrom(line(60, 100, 1));
    const spy = barsFrom(line(60, 100, 0)).filter((_, i) => i % 7 !== 0);
    expect(relativeReturns(stock, spy)).not.toBeNull();
  });

  it("returns null with no benchmark", () => {
    expect(relativeReturns(barsFrom(line(60, 100, 1)), [])).toBeNull();
  });
});

describe("fibonacci of the last up-leg", () => {
  it("measures from the leg's low to its high", () => {
    // Flat 100, rise to 200, pull back to 170.
    const closes = [...Array(20).fill(100), ...line(50, 100, 2), ...line(15, 198, -2)];
    const bars = barsFrom(closes);
    const f = lastUpLegFib(bars)!;
    const hi = 198 * 1.01;
    const lo = 100 * 0.99;
    expect(f.legHigh).toBeCloseTo(hi, 1);
    expect(f.legLow).toBeCloseTo(lo, 1);
    expect(f.retrace500).toBeCloseTo((hi + lo) / 2, 1);
    expect(f.retrace618).toBeCloseTo(hi - (hi - lo) * 0.618, 1);
    expect(f.extension1618).toBeCloseTo(lo + (hi - lo) * 1.618, 1);
  });
});

describe("trend template and verdict", () => {
  const strong = barsFrom(Array.from({ length: 260 }, (_, i) => 50 * Math.pow(1.004, i)));
  const spyFlat = barsFrom(Array(260).fill(400));

  it("a year-long steady advance that beats SPY passes all 8", () => {
    const closes = strong.map((b) => b.close);
    const last = closes[closes.length - 1];
    const tt = trendTemplate(closes, last, last * 1.01, 50 * 0.99, relativeReturns(strong, spyFlat))!;
    expect(tt.passed).toBe(8);
    expect(tt.pass).toBe(true);
    expect(tt.failing).toEqual([]);
  });

  it("names the criteria that fail", () => {
    const closes = strong.map((b) => b.close);
    const last = closes[closes.length - 1];
    const tt = trendTemplate(closes, last, last * 1.01, 50 * 0.99, null)!;
    expect(tt.passed).toBe(7);
    expect(tt.failing).toEqual(["Beat SPY over 3 and 6 months (stand-in for RS rating ≥ 70)"]);
  });

  it("needs 220 bars for a rising-200-day read", () => {
    const closes = line(150, 50, 1);
    expect(trendTemplate(closes, 200, 200, 50, null)).toBeNull();
  });

  it("verdicts follow the stated order", () => {
    expect(trendVerdict(90, 95, 100, null)).toBe("DOWNTREND");
    expect(trendVerdict(90, 105, 100, null)).toBe("BROKEN");
    expect(trendVerdict(102, 110, 100, null)).toBe("PULLBACK_IN_UPTREND");
    expect(trendVerdict(120, 110, 100, null)).toBe("UPTREND");
    expect(trendVerdict(102, 98, 100, null)).toBe("BASING");
    expect(trendVerdict(102, 98, 100, null, "RISING")).toBe("BASING");
    // Above a falling 200-day with the 50-day under it: a rally in a downtrend.
    expect(trendVerdict(102, 98, 100, null, "FALLING")).toBe("DOWNTREND");
    const base = { pivot: 125, low: 110, depthPct: 12, lengthBars: 30, startDate: "", endDate: "", lastContractionPct: 3, brokenOut: false };
    expect(trendVerdict(120, 110, 100, base)).toBe("BASING");
    expect(trendVerdict(126, 110, 100, { ...base, brokenOut: true })).toBe("UPTREND");
  });
});

describe("computePriceStructure", () => {
  const stock = barsFrom(Array.from({ length: 260 }, (_, i) => 50 * Math.pow(1.004, i)), 2_000_000);
  const spy = barsFrom(Array(260).fill(400));

  it("returns every block with dollar values", () => {
    const ps = computePriceStructure({ bars: stock, spyBars: spy, sectorBars: spy, sectorEtf: "XLK" })!;
    expect(ps.bars).toBe(260);
    expect(ps.sma.d200?.value).toBeGreaterThan(0);
    expect(ps.sma.d200?.slope).toBe("RISING");
    expect(ps.atr14?.dollars).toBeGreaterThan(0);
    expect(ps.relativeStrength.vsSpy?.m3).toBeGreaterThan(0);
    expect(ps.relativeStrength.vsSector?.etf).toBe("XLK");
    expect(ps.verdict).toBe("UPTREND");
    expect(ps.suggested.trendStrength?.score).toBe(3);
    expect(ps.suggested.relativeStrength?.score).toBe(3);
    expect(ps.volume.avgDollarVolume50).toBeGreaterThan(0);
  });

  it("measures distances from the live price, levels from completed bars", () => {
    const ps = computePriceStructure({ bars: stock, price: 1 })!;
    expect(ps.price).toBe(1);
    expect(ps.sma.d50!.pctFromPrice).toBeLessThan(-90);
    expect(ps.verdict).toBe("BROKEN");
    expect(ps.suggested.trendStrength?.score).toBe(0);
  });

  it("returns null under 20 bars", () => {
    expect(computePriceStructure({ bars: barsFrom(line(19, 10, 1)) })).toBeNull();
  });

  it("works on a short history without the 200-day", () => {
    const ps = computePriceStructure({ bars: barsFrom(line(60, 10, 0.5)) })!;
    expect(ps.sma.d200).toBeNull();
    expect(ps.trendTemplate).toBeNull();
    expect(ps.verdict).not.toBeNull();
  });
});

describe("sectorEtfFor", () => {
  it.each([
    ["Semiconductors", "SMH"],
    ["Biotechnology", "XBI"],
    ["Pharmaceuticals", "XLV"],
    ["Technology", "XLK"],
    ["Banking", "XLF"],
    ["Media", "XLC"],
    ["Aerospace & Defense", "XLI"],
    ["Retail", "XLY"],
    ["Utilities", "XLU"],
  ])("%s → %s", (industry, etf) => {
    expect(sectorEtfFor(industry)).toBe(etf);
  });

  it("unknown or empty → null, never a guess", () => {
    expect(sectorEtfFor("N/A")).toBeNull();
    expect(sectorEtfFor(null)).toBeNull();
  });
});
