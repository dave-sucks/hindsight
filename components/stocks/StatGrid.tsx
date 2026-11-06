/**
 * The stock page's stat rows: label left, number right, a hairline under
 * each, read down columns. One row shape (`StatList`), the same row with a
 * bar in the middle (`BarList`, the margins) and the rows down two or three
 * columns (`StatGrid`). The Overview's six and every group on the
 * Fundamentals tab draw from here, so a number looks the same wherever it is.
 */

import { cn } from "@/lib/utils";
import type { BarStat, Stat, StatColumns } from "@/lib/stocks/stock-stats";

const ROW = "border-b border-border/40 py-2 text-sm";

/** Stat rows in one column. */
export function StatList({ stats }: { stats: Stat[] }) {
  return (
    <dl>
      {stats.map((s) => (
        <div key={s.label} className={cn(ROW, "flex items-baseline justify-between gap-3")}>
          <dt className="text-muted-foreground truncate">{s.label}</dt>
          <dd className="shrink-0 tabular-nums">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatGrid({ columns }: { columns: StatColumns }) {
  // Columns follow the grid's own width, not the viewport's: beside the
  // sidebar the main column is narrow long before the window is. The grid
  // never has more tracks than columns, so two columns fill their width.
  return (
    <div className="@container">
      <div className={cn("grid grid-cols-1 gap-x-8", columns.length >= 2 && "@md:grid-cols-2", columns.length >= 3 && "@2xl:grid-cols-3")}>
        {columns.map((col, i) => (
          <StatList key={i} stats={col} />
        ))}
      </div>
    </div>
  );
}

/**
 * Stat rows with a bar between the label and the number, for a group of
 * rates: a margin, a growth rate, a return. The bars share one scale, from
 * the group's lowest number (or zero) to its highest (or `floor`: 100 for
 * margins, so a 40% margin reads as less than half); a bar runs from zero
 * to its number, so a loss runs left of the zero mark.
 */
export function BarList({ stats, floor = 0 }: { stats: BarStat[]; floor?: number }) {
  const ns = stats.map((s) => s.n);
  const lo = Math.min(0, ...ns);
  const hi = Math.max(floor, ...ns);
  const span = hi - lo || 1;
  const at = (n: number) => ((n - lo) / span) * 100;
  const zero = at(0);
  return (
    <dl>
      {stats.map((s) => {
        const v = at(s.n);
        return (
          <div key={s.label} className={cn(ROW, "flex items-center gap-3")}>
            <dt className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</dt>
            {/* Every bar is the same length, so the rows line up and a long label keeps its room. */}
            <div className="relative h-1 w-12 shrink-0 rounded-full bg-muted">
              <div
                className="absolute inset-y-0 rounded-full bg-foreground/30"
                style={{ left: `${Math.min(zero, v)}%`, width: `${Math.abs(v - zero)}%` }}
              />
              {lo < 0 ? <span className="absolute -inset-y-0.5 w-px bg-muted-foreground/60" style={{ left: `${zero}%` }} /> : null}
            </div>
            <dd className="min-w-12 shrink-0 text-right tabular-nums">{s.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
