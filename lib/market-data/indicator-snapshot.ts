/**
 * indicator-snapshot.ts — the chart numbers a trigger reads, stored daily.
 *
 * The 5-minute trigger evaluator has a live quote and nothing else. That is
 * why VS_SMA never fired (no average), RSI was a stub (no closes) and the
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
   * INSIDER_CLUSTER then reads false.
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

/** Today's volume so far ÷ the 20-session average. */
export function volumeRatio(snap: IndicatorSnapshot, todayVolume: number | null | undefined): number | null {
  if (todayVolume == null || !snap.volumeAvg20) return null;
  return todayVolume / snap.volumeAvg20;
}
