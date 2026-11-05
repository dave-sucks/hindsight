/**
 * RangeBar — where the price sits between a low and a high (the owner,
 * 2026-11-05, after Robinhood's Summary): a thin track, the run from the
 * low to the current price, a dot at the price, and the two ends named
 * under it. "Today" is the session's range, "52 week" the year's.
 */

import { SectionLabel } from "@/components/domain/section-label";
import { fmtMoney } from "@/lib/stocks/stock-stats";

export function RangeBar({ label, low, high, current }: { label: string; low: number | null; high: number | null; current: number | null }) {
  const pct =
    low != null && high != null && current != null && high > low
      ? Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100))
      : null;
  return (
    <div className="space-y-2">
      <SectionLabel>{label}</SectionLabel>
      <div className="relative h-1.5 rounded-full bg-muted">
        {pct != null ? (
          <>
            <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/30" style={{ width: `${pct}%` }} />
            <span
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
              style={{ left: `${pct}%` }}
            />
          </>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between text-sm tabular-nums">
        <span>
          <span className="mr-1.5 text-xs text-muted-foreground">L</span>
          {fmtMoney(low)}
        </span>
        <span>
          {fmtMoney(high)}
          <span className="ml-1.5 text-xs text-muted-foreground">H</span>
        </span>
      </div>
    </div>
  );
}
