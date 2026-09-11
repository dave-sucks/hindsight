/**
 * price-structure.ts — the chart, computed once, read by every agent.
 *
 * Pure functions over a year of daily bars (plus SPY and the sector ETF's
 * bars for relative strength). No I/O, no clock: the caller fetches the bars
 * and passes the live price; everything here is arithmetic, so every number
 * is unit-testable on synthetic bars.
 *
 * Why this exists (DAV-243, docs/plans/AGENT_REBUILD.md §1.3): the thesis
 * writer used to price a whole plan off six numbers over 90 days of bars —
 * no 200-day, no ATR, no swing points, no base, no relative strength. A
 * writer asked to "anchor the stop to structure" had no structure to anchor
 * to. The setups in docs/plans/TRADING_PLAYBOOK.md Part D each name the
 * numbers they need; this module is where those numbers come from.
 *
 * Bars are COMPLETED sessions. The caller drops today's partial bar while
 * the market is open and passes the live quote as `price`, so levels come
 * from finished days and distances are measured from the tape.
 */

export interface DailyBar {
  /** YYYY-MM-DD, the session date. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Slope = "RISING" | "FALLING" | "FLAT";

export type TrendVerdict =
  | "UPTREND"
  | "PULLBACK_IN_UPTREND"
  | "BASING"
  | "DOWNTREND"
  | "BROKEN";

export interface MovingAverage {
  value: number;
  /** Direction over the last SLOPE_LOOKBACK bars. */
  slope: Slope;
  /** Live price vs the average, percent. */
  pctFromPrice: number;
}

export interface SwingPoint {
  price: number;
  date: string;
}

export interface Base {
  /** The base's high — the pivot a breakout clears. */
  pivot: number;
  low: number;
  /** (pivot − low) ÷ pivot, percent. */
  depthPct: number;
  lengthBars: number;
  startDate: string;
  endDate: string;
  /** Range of the base's final LAST_CONTRACTION_BARS sessions, percent of their high. */
  lastContractionPct: number;
  /** Live price above the pivot — the base has been broken out of. */
  brokenOut: boolean;
}

export interface Gap {
  date: string;
  direction: "UP" | "DOWN";
  /** Open vs the prior close, percent (signed). */
  pct: number;
  /** Gap-day volume ÷ the 20 sessions before it. */
  volumeRatio: number | null;
  low: number;
  mid: number;
  high: number;
}

export interface RelativeReturns {
  /** Stock return minus benchmark return, percentage points. */
  m1: number | null;
  m3: number | null;
  m6: number | null;
}

export interface FibLevels {
  legLow: number;
  legLowDate: string;
  legHigh: number;
  legHighDate: string;
  retrace382: number;
  retrace500: number;
  retrace618: number;
  extension1272: number;
  extension1618: number;
}

export interface TrendTemplate {
  passed: number;
  of: number;
  pass: boolean;
  /** The criteria that failed, by name — the ones that passed go unsaid. */
  failing: string[];
}

export interface SuggestedScore {
  score: number;
  note: string;
}

export interface PriceStructure {
  /** Date of the last completed bar. */
  asOf: string;
  bars: number;
  /** Live price when given, else the last close. */
  price: number;
  lastClose: number;
  sma: {
    d20: MovingAverage | null;
    d50: MovingAverage | null;
    d150: MovingAverage | null;
    d200: MovingAverage | null;
  };
  ema: { d10: number | null; d21: number | null };
  rsi14: number | null;
  atr14: { dollars: number; pct: number } | null;
  /** Average daily range over 20 sessions, percent (high ÷ low − 1). */
  adr20Pct: number | null;
  range: {
    high20: number;
    low20: number;
    high52w: number;
    low52w: number;
    pctBelow52wHigh: number;
    pctAbove52wLow: number;
  };
  swings: { lastHigh: SwingPoint | null; lastLow: SwingPoint | null };
  base: Base | null;
  volume: {
    /** Last session's volume ÷ the 20 before it. */
    lastVsAvg20: number | null;
    avg20: number | null;
    /** 50-session average of close × volume, dollars. */
    avgDollarVolume50: number | null;
    /** Σ volume on up-close days ÷ Σ volume on down-close days, last 20 sessions. */
    upDownRatio20: number | null;
  };
  /** Gaps ≥ GAP_MIN_PCT in the last GAP_LOOKBACK sessions, newest first. */
  gaps: Gap[];
  relativeStrength: {
    vsSpy: RelativeReturns | null;
    vsSector: (RelativeReturns & { etf: string }) | null;
  };
  /** Retracement/extension of the last up-leg. Candidates, never a reason on their own. */
  fib: FibLevels | null;
  trendTemplate: TrendTemplate | null;
  verdict: TrendVerdict | null;
  /** Computed defaults for the writer's composite; the model may override with a note. */
  suggested: {
    trendStrength: SuggestedScore | null;
    relativeStrength: SuggestedScore | null;
  };
}

// ── Constants (documented, not settings) ─────────────────────────────────

/** Bars over which an average's slope is read (≈ one month). */
export const SLOPE_LOOKBACK = 20;
/** A slope under this percent over SLOPE_LOOKBACK bars is FLAT. */
export const FLAT_SLOPE_PCT = 0.5;
/** A swing high/low needs this many bars on EACH side that don't exceed it. */
export const SWING_LOOKAROUND = 5;
/** A base is a consolidation whose high-to-low range is at most this... */
export const BASE_MAX_DEPTH_PCT = 15;
/** ...held for at least this many sessions. */
export const BASE_MIN_BARS = 20;
/**
 * A base's first-to-last close may drift at most this share of its range
 * (sideways, not a climb). At 1/2, MSFT's 2026-08 base swallowed the last
 * day of its earnings run (07-31, low $449) and read 13% deep; at 1/3 it
 * starts 08-03 — $475 to $518, 8% — which is the base on the chart.
 */
export const BASE_MAX_DRIFT_SHARE = 1 / 3;
/** A base may have ended this many sessions ago and still count (a fresh breakout). */
export const BASE_RECENT_END_BARS = 5;
/** The final stretch of a base whose tightness is reported (VCP read). */
export const LAST_CONTRACTION_BARS = 10;
export const GAP_MIN_PCT = 3;
export const GAP_LOOKBACK = 10;
/** Sessions per month for return windows. */
export const M1 = 21;
export const M3 = 63;
export const M6 = 126;
/** The up-leg for fib levels is found inside this many sessions. */
export const FIB_LOOKBACK = 126;

// ── Small helpers ─────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pctChange = (from: number, to: number) => ((to - from) / from) * 100;

export function sma(values: number[], period: number, endExclusive = values.length): number | null {
  if (endExclusive < period || period <= 0) return null;
  let sum = 0;
  for (let i = endExclusive - period; i < endExclusive; i++) sum += values[i];
  return sum / period;
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = sma(values.slice(0, period), period)!;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Wilder RSI. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return round1(100 - 100 / (1 + avgGain / avgLoss));
}

/** Wilder ATR over true range. */
export function atr(bars: DailyBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  let a = tr.slice(0, period).reduce((s, x) => s + x, 0) / period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

export function adrPct(bars: DailyBar[], period = 20): number | null {
  if (bars.length < period) return null;
  const tail = bars.slice(-period);
  return (tail.reduce((s, b) => s + (b.low > 0 ? b.high / b.low - 1 : 0), 0) / period) * 100;
}

function movingAverage(closes: number[], period: number, price: number): MovingAverage | null {
  const now = sma(closes, period);
  if (now == null) return null;
  const then = sma(closes, period, closes.length - SLOPE_LOOKBACK);
  let slope: Slope = "FLAT";
  if (then != null) {
    const move = pctChange(then, now);
    slope = move > FLAT_SLOPE_PCT ? "RISING" : move < -FLAT_SLOPE_PCT ? "FALLING" : "FLAT";
  }
  return { value: round2(now), slope, pctFromPrice: round2(pctChange(now, price)) };
}

/**
 * The most recent swing high and swing low: a bar whose high (low) is
 * strictly beyond the SWING_LOOKAROUND bars before it and not exceeded by
 * the SWING_LOOKAROUND bars after it (strict on the left so a flat stretch
 * isn't a row of swings; a later equal high is allowed). The newest
 * SWING_LOOKAROUND bars can't qualify yet — a swing is only known once the
 * bars after it have printed.
 */
export function lastSwings(
  bars: DailyBar[],
  k = SWING_LOOKAROUND,
): { lastHigh: SwingPoint | null; lastLow: SwingPoint | null } {
  let lastHigh: SwingPoint | null = null;
  let lastLow: SwingPoint | null = null;
  for (let i = bars.length - 1 - k; i >= k && (!lastHigh || !lastLow); i--) {
    let isHigh = !lastHigh;
    let isLow = !lastLow;
    for (let j = i - k; j <= i + k && (isHigh || isLow); j++) {
      if (j === i) continue;
      if (j < i ? bars[j].high >= bars[i].high : bars[j].high > bars[i].high) isHigh = false;
      if (j < i ? bars[j].low <= bars[i].low : bars[j].low < bars[i].low) isLow = false;
    }
    if (isHigh) lastHigh = { price: bars[i].high, date: bars[i].date };
    if (isLow) lastLow = { price: bars[i].low, date: bars[i].date };
  }
  return { lastHigh, lastLow };
}

/**
 * The longest consolidation ending at the last bar or within
 * BASE_RECENT_END_BARS of it (so a base broken out of this week still reads
 * as the base, pivot intact). A consolidation is at least BASE_MIN_BARS
 * sessions whose high-to-low range is at most BASE_MAX_DEPTH_PCT AND that
 * went sideways: first-to-last close moved no more than
 * BASE_MAX_DRIFT_SHARE of the range. Without the drift test a steady
 * 10%-a-month climb reads as a base.
 */
export function detectBase(bars: DailyBar[], price: number): Base | null {
  let best: { start: number; end: number; hi: number; lo: number } | null = null;
  const last = bars.length - 1;
  for (let end = last; end >= Math.max(0, last - BASE_RECENT_END_BARS); end--) {
    let hi = bars[end].high;
    let lo = bars[end].low;
    for (let i = end - 1; i >= 0; i--) {
      const nhi = Math.max(hi, bars[i].high);
      const nlo = Math.min(lo, bars[i].low);
      if (((nhi - nlo) / nhi) * 100 > BASE_MAX_DEPTH_PCT) break;
      hi = nhi;
      lo = nlo;
      const len = end - i + 1;
      const drift = Math.abs(bars[end].close - bars[i].close);
      if (
        len >= BASE_MIN_BARS &&
        drift <= BASE_MAX_DRIFT_SHARE * (hi - lo) &&
        (!best || len > best.end - best.start + 1)
      ) {
        best = { start: i, end, hi, lo };
      }
    }
  }
  if (!best) return null;
  const tail = bars.slice(Math.max(best.start, best.end - LAST_CONTRACTION_BARS + 1), best.end + 1);
  const tHi = Math.max(...tail.map((b) => b.high));
  const tLo = Math.min(...tail.map((b) => b.low));
  return {
    pivot: round2(best.hi),
    low: round2(best.lo),
    depthPct: round1(((best.hi - best.lo) / best.hi) * 100),
    lengthBars: best.end - best.start + 1,
    startDate: bars[best.start].date,
    endDate: bars[best.end].date,
    lastContractionPct: round1(((tHi - tLo) / tHi) * 100),
    brokenOut: price > best.hi,
  };
}

export function recentGaps(bars: DailyBar[]): Gap[] {
  const out: Gap[] = [];
  for (let i = bars.length - 1; i >= Math.max(1, bars.length - GAP_LOOKBACK); i--) {
    const pc = bars[i - 1].close;
    if (pc <= 0) continue;
    const pct = pctChange(pc, bars[i].open);
    if (Math.abs(pct) < GAP_MIN_PCT) continue;
    const prior = bars.slice(Math.max(0, i - 20), i).map((b) => b.volume);
    const avg = prior.length >= 10 ? prior.reduce((s, v) => s + v, 0) / prior.length : null;
    const b = bars[i];
    out.push({
      date: b.date,
      direction: pct > 0 ? "UP" : "DOWN",
      pct: round2(pct),
      volumeRatio: avg && avg > 0 ? round2(b.volume / avg) : null,
      low: round2(b.low),
      mid: round2((b.high + b.low) / 2),
      high: round2(b.high),
    });
  }
  return out;
}

function windowReturn(closes: number[], n: number): number | null {
  if (closes.length <= n) return null;
  const from = closes[closes.length - 1 - n];
  return from > 0 ? pctChange(from, closes[closes.length - 1]) : null;
}

/**
 * Stock minus benchmark return over 1/3/6 months, aligned by date (the
 * stock's and the ETF's bars need not start on the same day).
 */
export function relativeReturns(stock: DailyBar[], bench: DailyBar[]): RelativeReturns | null {
  if (bench.length === 0) return null;
  const benchByDate = new Map(bench.map((b) => [b.date, b.close]));
  const aligned = stock.filter((b) => benchByDate.has(b.date));
  if (aligned.length <= M1) return null;
  const s = aligned.map((b) => b.close);
  const bm = aligned.map((b) => benchByDate.get(b.date)!);
  const diff = (n: number) => {
    const a = windowReturn(s, n);
    const b = windowReturn(bm, n);
    return a != null && b != null ? round1(a - b) : null;
  };
  return { m1: diff(M1), m3: diff(M3), m6: diff(M6) };
}

/**
 * The last up-leg: the highest high of the last FIB_LOOKBACK sessions, and
 * the lowest low in the FIB_LOOKBACK sessions before it. Levels only — the
 * playbook (Part A) treats fib as confluence with a real level, never alone.
 */
export function lastUpLegFib(bars: DailyBar[]): FibLevels | null {
  if (bars.length < 30) return null;
  const from = Math.max(0, bars.length - FIB_LOOKBACK);
  let hiIdx = from;
  for (let i = from; i < bars.length; i++) if (bars[i].high >= bars[hiIdx].high) hiIdx = i;
  let loIdx = Math.max(0, hiIdx - FIB_LOOKBACK);
  for (let i = loIdx; i <= hiIdx; i++) if (bars[i].low < bars[loIdx].low) loIdx = i;
  const hi = bars[hiIdx].high;
  const lo = bars[loIdx].low;
  if (loIdx >= hiIdx || hi <= lo) return null;
  const r = hi - lo;
  return {
    legLow: round2(lo),
    legLowDate: bars[loIdx].date,
    legHigh: round2(hi),
    legHighDate: bars[hiIdx].date,
    retrace382: round2(hi - r * 0.382),
    retrace500: round2(hi - r * 0.5),
    retrace618: round2(hi - r * 0.618),
    extension1272: round2(lo + r * 1.272),
    extension1618: round2(lo + r * 1.618),
  };
}

/**
 * Minervini's Trend Template (playbook D1). Criterion 8 is IBD's RS rating
 * ≥ 70, which we don't have; the stand-in is "beat SPY over both 3 and 6
 * months", said as such in its name.
 */
export function trendTemplate(
  closes: number[],
  price: number,
  high52w: number,
  low52w: number,
  vsSpy: RelativeReturns | null,
): TrendTemplate | null {
  const s50 = sma(closes, 50);
  const s150 = sma(closes, 150);
  const s200 = sma(closes, 200);
  const s200Then = sma(closes, 200, closes.length - SLOPE_LOOKBACK);
  if (s50 == null || s150 == null || s200 == null || s200Then == null) return null;
  const criteria: { name: string; pass: boolean }[] = [
    { name: "Price above the 150-day and 200-day", pass: price > s150 && price > s200 },
    { name: "150-day above the 200-day", pass: s150 > s200 },
    { name: "200-day rising for at least a month", pass: s200 > s200Then },
    { name: "50-day above the 150-day and 200-day", pass: s50 > s150 && s50 > s200 },
    { name: "Price above the 50-day", pass: price > s50 },
    { name: "Price at least 30% above the 52-week low", pass: price >= low52w * 1.3 },
    { name: "Price within 25% of the 52-week high", pass: price >= high52w * 0.75 },
    {
      name: "Beat SPY over 3 and 6 months (stand-in for RS rating ≥ 70)",
      pass: vsSpy?.m3 != null && vsSpy.m6 != null && vsSpy.m3 > 0 && vsSpy.m6 > 0,
    },
  ];
  const passed = criteria.filter((c) => c.pass).length;
  return {
    passed,
    of: criteria.length,
    pass: passed === criteria.length,
    failing: criteria.filter((c) => !c.pass).map((c) => c.name),
  };
}

/**
 * One word for the chart. Order matters: a broken 200-day outranks a tight
 * base, and a tight base above a rising 200-day outranks "pullback".
 *   DOWNTREND  — below the 200-day with the 50-day under it; or above a
 *                FALLING 200-day with the 50-day still under it (a rally
 *                inside a downtrend — Weinstein's Stage 2 needs the average
 *                to turn up first; SMMT 2026-09: +40% in a month on two
 *                gaps, 200-day still falling)
 *   BROKEN     — below the 200-day while the 50-day is still above it
 *   BASING     — above the 200-day and inside a base (between its low and
 *                pivot), or above a flat/rising 200-day with the 50-day
 *                still under it (the turn out of a decline)
 *   PULLBACK_IN_UPTREND — above the 200-day, below the 50-day
 *   UPTREND    — above both, 50-day over 200-day
 * Without a 200-day (under 200 bars), the 50-day stands in.
 */
export function trendVerdict(
  price: number,
  s50: number | null,
  s200: number | null,
  base: Base | null,
  s200Slope: Slope | null = null,
): TrendVerdict | null {
  const long = s200 ?? s50;
  if (long == null) return null;
  const mid = s200 != null ? s50 : null;
  if (price < long) return mid != null && mid > long ? "BROKEN" : "DOWNTREND";
  if (mid != null && mid < long && s200Slope === "FALLING") return "DOWNTREND";
  if (base && price >= base.low && price <= base.pivot) return "BASING";
  if (mid != null && price < mid) return "PULLBACK_IN_UPTREND";
  if (mid != null && mid < long) return "BASING";
  return "UPTREND";
}

function suggestTrendStrength(
  verdict: TrendVerdict | null,
  tt: TrendTemplate | null,
  s200: MovingAverage | null,
  price: number,
): SuggestedScore | null {
  if (!verdict) return null;
  if (verdict === "BROKEN") return { score: 0, note: "Broke the 200-day." };
  if (verdict === "DOWNTREND") {
    return {
      score: 0,
      note: price < (s200?.value ?? Infinity)
        ? "Below the 200-day."
        : "Above a falling 200-day with the 50-day under it — a rally inside a downtrend.",
    };
  }
  if (verdict === "PULLBACK_IN_UPTREND") {
    return { score: 1, note: "Above the 200-day, pulled back under the 50-day." };
  }
  const ttNote = tt ? ` Trend Template ${tt.passed}/${tt.of}.` : "";
  if (tt && tt.passed >= 7 && s200?.slope === "RISING") {
    return { score: 3, note: `${verdict === "BASING" ? "Basing" : "Uptrend"} over a rising 200-day.${ttNote}` };
  }
  return { score: 2, note: `${verdict === "BASING" ? "Basing" : "Uptrend"} above the 200-day.${ttNote}` };
}

function suggestRelativeStrength(vsSpy: RelativeReturns | null): SuggestedScore | null {
  if (!vsSpy) return null;
  const windows = [vsSpy.m1, vsSpy.m3, vsSpy.m6].filter((x): x is number => x != null);
  if (windows.length === 0) return null;
  const ahead = windows.filter((x) => x > 0).length;
  const fmt = (x: number | null, l: string) => (x == null ? null : `${l} ${x >= 0 ? "+" : ""}${x}pts`);
  const note = `vs SPY: ${[fmt(vsSpy.m1, "1M"), fmt(vsSpy.m3, "3M"), fmt(vsSpy.m6, "6M")].filter(Boolean).join(", ")}.`;
  let score = 0;
  if (ahead === windows.length && (vsSpy.m3 ?? 0) >= 10) score = 3;
  else if (ahead >= 2) score = 2;
  else if (ahead === 1) score = 1;
  return { score, note };
}

// ── The one entry point ───────────────────────────────────────────────────

export interface PriceStructureInput {
  /** Completed daily bars, oldest first. */
  bars: DailyBar[];
  /** Live price; defaults to the last close. */
  price?: number | null;
  spyBars?: DailyBar[];
  sectorBars?: DailyBar[];
  sectorEtf?: string | null;
}

/** Below this many bars there is no chart worth reading. */
export const MIN_BARS = 20;

export function computePriceStructure(input: PriceStructureInput): PriceStructure | null {
  const bars = input.bars.filter((b) => b.close > 0 && b.high >= b.low);
  if (bars.length < MIN_BARS) return null;
  const closes = bars.map((b) => b.close);
  const lastClose = closes[closes.length - 1];
  const price = input.price && input.price > 0 ? input.price : lastClose;

  const year = bars.slice(-252);
  const high52w = Math.max(...year.map((b) => b.high));
  const low52w = Math.min(...year.map((b) => b.low));
  const month = bars.slice(-20);
  const high20 = Math.max(...month.map((b) => b.high));
  const low20 = Math.min(...month.map((b) => b.low));

  const d20 = movingAverage(closes, 20, price);
  const d50 = movingAverage(closes, 50, price);
  const d150 = movingAverage(closes, 150, price);
  const d200 = movingAverage(closes, 200, price);

  const e10 = ema(closes, 10);
  const e21 = ema(closes, 21);
  const a14 = atr(bars, 14);
  const adr = adrPct(bars, 20);

  const vols = bars.map((b) => b.volume);
  const avg20Prior = sma(vols, 20, vols.length - 1);
  const lastVol = vols[vols.length - 1];
  const dollarVols = bars.map((b) => b.close * b.volume);
  const adv50 = sma(dollarVols, 50);
  let upVol = 0;
  let downVol = 0;
  for (let i = Math.max(1, bars.length - 20); i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) upVol += bars[i].volume;
    else if (bars[i].close < bars[i - 1].close) downVol += bars[i].volume;
  }

  const base = detectBase(bars, price);
  const vsSpy = input.spyBars ? relativeReturns(bars, input.spyBars) : null;
  const vsSectorRaw =
    input.sectorBars && input.sectorEtf ? relativeReturns(bars, input.sectorBars) : null;
  const tt = trendTemplate(closes, price, high52w, low52w, vsSpy);
  const verdict = trendVerdict(price, d50?.value ?? null, d200?.value ?? null, base, d200?.slope ?? null);

  return {
    asOf: bars[bars.length - 1].date,
    bars: bars.length,
    price: round2(price),
    lastClose: round2(lastClose),
    sma: { d20, d50, d150, d200 },
    ema: { d10: e10 != null ? round2(e10) : null, d21: e21 != null ? round2(e21) : null },
    rsi14: rsi(closes),
    atr14: a14 != null ? { dollars: round2(a14), pct: round2((a14 / price) * 100) } : null,
    adr20Pct: adr != null ? round2(adr) : null,
    range: {
      high20: round2(high20),
      low20: round2(low20),
      high52w: round2(high52w),
      low52w: round2(low52w),
      pctBelow52wHigh: round1(((high52w - price) / high52w) * 100),
      pctAbove52wLow: round1(pctChange(low52w, price)),
    },
    swings: lastSwings(bars),
    base,
    volume: {
      lastVsAvg20: avg20Prior && avg20Prior > 0 ? round2(lastVol / avg20Prior) : null,
      avg20: avg20Prior != null ? Math.round(avg20Prior) : null,
      avgDollarVolume50: adv50 != null ? Math.round(adv50) : null,
      upDownRatio20: downVol > 0 ? round2(upVol / downVol) : null,
    },
    gaps: recentGaps(bars),
    relativeStrength: {
      vsSpy,
      vsSector: vsSectorRaw && input.sectorEtf ? { etf: input.sectorEtf, ...vsSectorRaw } : null,
    },
    fib: lastUpLegFib(bars),
    trendTemplate: tt,
    verdict,
    suggested: {
      trendStrength: suggestTrendStrength(verdict, tt, d200, price),
      relativeStrength: suggestRelativeStrength(vsSpy),
    },
  };
}

// ── Sector benchmark ──────────────────────────────────────────────────────

/**
 * Finnhub's `finnhubIndustry` → the ETF a stock's relative strength is
 * measured against. Semis and biotech get their own ETFs (SMH, XBI) because
 * the SPDR sector fund is dominated by a few mega-caps that aren't the
 * stock's real peers. Unknown labels return null — no sector line, never a
 * guess.
 */
const SECTOR_ETF_RULES: [RegExp, string][] = [
  [/semiconductor/i, "SMH"],
  [/biotech|life sciences/i, "XBI"],
  [/pharma|health|medical/i, "XLV"],
  [/bank|financial|insurance|capital markets/i, "XLF"],
  [/software|technology|tech|electronic|communications equipment|it services/i, "XLK"],
  [/media|telecom|communication|entertainment|interactive/i, "XLC"],
  [/oil|gas|energy/i, "XLE"],
  [/utilit/i, "XLU"],
  [/real estate|reit/i, "XLRE"],
  [/chemical|metal|mining|material|packaging|paper|forest/i, "XLB"],
  [/aerospace|defense|machinery|industrial|airline|transport|logistic|road|rail|marine|construction|building|electrical|commercial services|professional services|trading companies/i, "XLI"],
  [/food|beverage|tobacco|household|personal products|consumer staples/i, "XLP"],
  [/retail|auto|hotel|restaurant|leisure|textile|apparel|luxury|consumer|distributor|diversified consumer/i, "XLY"],
];

export function sectorEtfFor(industry: string | null | undefined): string | null {
  if (!industry) return null;
  for (const [re, etf] of SECTOR_ETF_RULES) if (re.test(industry)) return etf;
  return null;
}
