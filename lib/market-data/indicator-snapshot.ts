/**
 * indicator-snapshot.ts — the chart numbers a trigger reads, stored daily.
 *
 * The 5-minute trigger evaluator has a live quote and nothing else. That is
 * why vs-average never fired (no average), RSI was a stub (no closes) and the
 * 5D/20D move windows were deleted (no close series). The 06:30 ET job
 * (lib/inngest/functions/indicator-snapshot.ts) computes the chart for
 * every ticker on the book with lib/market-data/price-structure.ts and
 * stores THIS shape in TickerIndicators; the evaluator reads it next to the
 * quote. DAV-247, docs/plans/AGENT_REBUILD.md §3.
 *
 * Numbers only — never sentences (docs/plans/MARKET_DATA.md). Everything
 * here is as of the last COMPLETED session (`asOf`); the live quote supplies
 * today.
 */

import {
  rsi,
  sma,
  type DailyBar,
  type PriceStructure,
} from "@/lib/market-data/price-structure";
import { isMarketOpen, sessionProgress } from "@/lib/market-hours";

/** Closes kept for the move windows and RSI warm-up. */
export const SNAPSHOT_CLOSES = 60;

export interface SnapshotGap {
  /** 1 = the last completed session (yesterday, seen from today). */
  sessionsAgo: number;
  pct: number;
  volumeRatio: number | null;
  low: number;
  mid: number;
  high: number;
}

export interface IndicatorSnapshot {
  /** Date of the last completed bar (YYYY-MM-DD). */
  asOf: string;
  sma: { 20: number | null; 50: number | null; 150: number | null; 200: number | null };
  /** Highest high / lowest low of the last 20 completed sessions. */
  high20: number;
  low20: number;
  high52w: number;
  low52w: number;
  /** Average daily volume over the last 20 completed sessions. */
  volumeAvg20: number | null;
  /** Last SNAPSHOT_CLOSES completed closes, oldest first. */
  closes: number[];
  /** Stock minus SPY return, percentage points. */
  rsVsSpy: { "1M": number | null; "3M": number | null; "6M": number | null };
  /** 3%+ UP gaps in the last 10 completed sessions. */
  gaps: SnapshotGap[];
  atr14: number | null;
  /**
   * Open-market insider purchases in the last INSIDER_LOOKBACK_DAYS (DAV-252).
   * Absent on snapshots written before it, or when the vendor didn't answer —
   * insider-buying then reads false.
   */
  insiderBuys?: import("@/lib/market-data/insider-cluster").InsiderBuy[];
}

export function toIndicatorSnapshot(structure: PriceStructure, bars: DailyBar[]): IndicatorSnapshot {
  const vols = bars.map((b) => b.volume);
  const avg = sma(vols, 20);
  const byDate = new Map(bars.map((b, i) => [b.date, i]));
  const last = bars.length - 1;
  return {
    asOf: structure.asOf,
    sma: {
      20: structure.sma.d20?.value ?? null,
      50: structure.sma.d50?.value ?? null,
      150: structure.sma.d150?.value ?? null,
      200: structure.sma.d200?.value ?? null,
    },
    high20: structure.range.high20,
    low20: structure.range.low20,
    high52w: structure.range.high52w,
    low52w: structure.range.low52w,
    volumeAvg20: avg != null ? Math.round(avg) : null,
    closes: bars.slice(-SNAPSHOT_CLOSES).map((b) => b.close),
    rsVsSpy: {
      "1M": structure.relativeStrength.vsSpy?.m1 ?? null,
      "3M": structure.relativeStrength.vsSpy?.m3 ?? null,
      "6M": structure.relativeStrength.vsSpy?.m6 ?? null,
    },
    gaps: structure.gaps
      .filter((g) => g.direction === "UP")
      .map((g) => ({
        sessionsAgo: last - (byDate.get(g.date) ?? last) + 1,
        pct: g.pct,
        volumeRatio: g.volumeRatio,
        low: g.low,
        mid: g.mid,
        high: g.high,
      })),
    atr14: structure.atr14?.dollars ?? null,
  };
}

/** Narrow an unknown Json column into a snapshot, or null. Never throws. */
export function parseIndicatorSnapshot(raw: unknown): IndicatorSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<IndicatorSnapshot>;
  if (typeof s.asOf !== "string" || !Array.isArray(s.closes) || typeof s.high52w !== "number") return null;
  return s as IndicatorSnapshot;
}

// ── Reads the evaluator makes ────────────────────────────────────────────

/** % move from the close N sessions back to `price`. N=5 → vs the close 5 sessions ago. */
export function movePctOverSessions(snap: IndicatorSnapshot, price: number, sessions: number): number | null {
  const base = snap.closes[snap.closes.length - sessions];
  return base != null && base > 0 ? ((price - base) / base) * 100 : null;
}

/** RSI with the live price as today's close. */
export function liveRsi(snap: IndicatorSnapshot, price: number, period: number): number | null {
  return rsi([...snap.closes, price], period);
}

/**
 * The chart numbers a stock's row carries (step 8): what the trigger check
 * reads, as numbers, with the live price as today's close where a figure
 * needs one. Null where the snapshot has nothing; the row omits nulls.
 */
export interface ChartFacts {
  /** The last completed session the numbers cover (YYYY-MM-DD). */
  asOf: string;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  /** RSI(14) with the live price as today's close; null without a price. */
  rsi14: number | null;
  /** % move from the close 5 and 20 sessions back to the live price; null without a price. */
  move5dPct: number | null;
  move20dPct: number | null;
  high20: number;
  low20: number;
  high52w: number;
  low52w: number;
  volumeAvg20: number | null;
  atr14: number | null;
  /** Stock minus SPY return, percentage points. */
  rsVsSpy1M: number | null;
  rsVsSpy3M: number | null;
}

const round = (n: number | null, places: number): number | null => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** places) / 10 ** places);

export function chartFacts(snap: IndicatorSnapshot, price: number | null): ChartFacts {
  const priced = price != null && price > 0;
  return {
    asOf: snap.asOf,
    sma20: round(snap.sma[20], 2),
    sma50: round(snap.sma[50], 2),
    sma200: round(snap.sma[200], 2),
    rsi14: priced ? round(liveRsi(snap, price, 14), 0) : null,
    move5dPct: priced ? round(movePctOverSessions(snap, price, 5), 1) : null,
    move20dPct: priced ? round(movePctOverSessions(snap, price, 20), 1) : null,
    high20: snap.high20,
    low20: snap.low20,
    high52w: snap.high52w,
    low52w: snap.low52w,
    volumeAvg20: snap.volumeAvg20,
    atr14: round(snap.atr14, 2),
    rsVsSpy1M: round(snap.rsVsSpy["1M"], 1),
    rsVsSpy3M: round(snap.rsVsSpy["3M"], 1),
  };
}

/**
 * The share of a normal day's volume traded by each minute of the session.
 * Measured 2026-11-23 from Alpaca's SIP 1-minute bars: the median, over 995
 * stock-days (the book's 50 tickers, the 20 sessions Oct 26–Nov 20), of the
 * pre-market plus session volume so far ÷ that day's whole 1Day bar, the two
 * numbers the check divides. It ends near 76% because the 4 PM closing auction
 * lands in the day bar after the last minute. It starts at minute 30: the first
 * minutes swing too much to pace (at 9:35, 31% of stock-days read 1.5×).
 */
const NORMAL_VOLUME_BY_MINUTE: ReadonlyArray<readonly [number, number]> = [
  [30, 0.0872], [45, 0.1214], [60, 0.1523], [90, 0.212], [120, 0.2636], [150, 0.3095], [180, 0.3545],
  [210, 0.392], [240, 0.4277], [270, 0.4662], [300, 0.5121], [330, 0.5558], [360, 0.6177], [375, 0.6618],
  [385, 0.7097], [389, 0.763],
];

/** How much of a normal day's volume has traded by `now`; 1 outside the session, where the day's volume is the whole day's. */
export function normalVolumeShare(now: Date | undefined): number {
  if (!now || !isMarketOpen(now)) return 1;
  const progress = sessionProgress(now);
  if (!progress) return 1;
  // A half day runs the same shape in fewer minutes.
  const minute = (progress.minutes / progress.total) * 390;
  const curve = NORMAL_VOLUME_BY_MINUTE;
  if (minute <= curve[0][0]) return curve[0][1];
  const next = curve.findIndex(([m]) => m >= minute);
  if (next < 0) return curve[curve.length - 1][1];
  const [m0, s0] = curve[next - 1];
  const [m1, s1] = curve[next];
  return s0 + ((s1 - s0) * (minute - m0)) / (m1 - m0);
}

/** Today's volume so far ÷ the normal volume by this time of day; after the close, the day's ÷ the 20-session average. */
export function volumeRatio(snap: IndicatorSnapshot, todayVolume: number | null | undefined, now: Date | undefined): number | null {
  if (todayVolume == null || !snap.volumeAvg20) return null;
  return todayVolume / (snap.volumeAvg20 * normalVolumeShare(now));
}
