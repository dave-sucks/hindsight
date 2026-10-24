/**
 * StatGrid — a row of labelled numbers (Prev close, Open, Day range …).
 * Label and value styles are the app's: small uppercase label, tabular value.
 */
export interface StatItem {
  label: string;
  value: string;
}

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3 sm:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</span>
          <span className="truncate text-sm font-medium tabular-nums text-foreground">{s.value}</span>
        </div>
      ))}
    </div>
  );
}
