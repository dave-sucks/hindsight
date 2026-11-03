/**
 * The stock page's stats: label left, number right, a hairline under each,
 * read down columns. The same grid draws the Overview's key stats and every
 * section of the Research tab, so a number looks the same wherever it is.
 */

import type { StatColumns, StatSection } from "@/lib/stocks/stock-stats";

export function StatGrid({ columns }: { columns: StatColumns }) {
  // Columns follow the grid's own width, not the viewport's: beside the
  // sidebar the main column is narrow long before the window is.
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-8 @md:grid-cols-2 @2xl:grid-cols-3">
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

/** A labelled grid: "Key stats" on the Overview, one per Research section. */
export function StatBlock({ label, columns }: StatSection) {
  return (
    <section className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <StatGrid columns={columns} />
    </section>
  );
}
