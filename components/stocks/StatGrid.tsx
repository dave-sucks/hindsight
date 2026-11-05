/**
 * The stock page's stats: label left, number right, a hairline under each,
 * read down columns. The same grid draws the Overview's six and the
 * Fundamentals tab's key figures, so a number looks the same wherever it is.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { StatColumns } from "@/lib/stocks/stock-stats";

export function StatGrid({ columns }: { columns: StatColumns }) {
  // Columns follow the grid's own width, not the viewport's: beside the
  // sidebar the main column is narrow long before the window is. The grid
  // never has more tracks than columns, so two columns fill their width.
  return (
    <div className="@container">
      <div className={cn("grid grid-cols-1 gap-x-8", columns.length >= 2 && "@md:grid-cols-2", columns.length >= 3 && "@2xl:grid-cols-3")}>
        {columns.map((col, i) => (
          <dl key={i}>
            {col.map((s) => (
              <div
                key={s.label}
                className="flex items-baseline justify-between gap-3 border-b border-border/40 py-2 text-sm"
              >
                <dt className="text-muted-foreground truncate">{s.label}</dt>
                <dd className="shrink-0 tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  );
}

/** Label / value rows in one column: the company's facts. */
export function FactList({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl>
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-3 border-b border-border/40 py-2 text-sm">
          <dt className="text-muted-foreground shrink-0">{r.label}</dt>
          <dd className="min-w-0 truncate text-right tabular-nums">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
