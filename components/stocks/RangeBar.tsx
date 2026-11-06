/**
 * RangeBar — where the price sits between a low and a high (the owner,
 * 2026-11-05, after Robinhood's Summary): a thin track in the gauges' one
 * muted color, the run from the low to the current price as a gradient of
 * that color up to a slightly brighter step of it (a quarter to two fifths, the owner, 2026-11-05), the price as a white line like
 * the Average on the targets ruler, and the two ends named under it.
 * "Today" is the session's range, "52 week" the year's. Square ends, like
 * the ticks and the ratings bar. Its words are a stat row's (the owner,
 * 2026-11-05): the title in the label's muted gray, the prices as values,
 * L and H as labels, all one size.
 */

import { fmtMoney } from "@/lib/stocks/stock-stats";

export function RangeBar({ label, low, high, current }: { label: string; low: number | null; high: number | null; current: number | null }) {
  const pct =
    low != null && high != null && current != null && high > low
      ? Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100))
      : null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="relative h-1.5 rounded-xs bg-muted-foreground/25">
        {pct != null ? (
          <>
            <div className="absolute inset-y-0 left-0 rounded-xs bg-gradient-to-r from-muted-foreground/25 to-muted-foreground/40" style={{ width: `${pct}%` }} />
            <span className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-xs bg-foreground" style={{ left: `${pct}%` }} />
          </>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between text-sm tabular-nums">
        <span>
          <span className="mr-1.5 text-muted-foreground">L</span>
          {fmtMoney(low)}
        </span>
        <span>
          {fmtMoney(high)}
          <span className="ml-1.5 text-muted-foreground">H</span>
        </span>
      </div>
    </div>
  );
}
