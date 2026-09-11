"use client";

/**
 * One company's earnings — the stock page's Earnings tab. Quarter chips
 * with the surprise, the latest report against the estimate, and the next
 * date. Live from the vendor when the tab renders; nothing stored.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EarningsResponse, EarningsCalendarEntry } from "@/lib/types/thesis-sheet";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function bell(hour: string | null): string {
  return hour === "bmo" ? "before open" : hour === "amc" ? "after close" : "";
}

function pctOf(actual: number | null, estimate: number | null): number | null {
  if (actual == null || estimate == null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

function ReportLine({
  label,
  estimate,
  actual,
  fmt,
}: {
  label: string;
  estimate: number | null;
  actual: number | null;
  fmt: (n: number) => string;
}) {
  const pct = pctOf(actual, estimate);
  return (
    <div className="grid grid-cols-[4rem_1fr_1fr_1fr] items-baseline gap-2 text-sm tabular-nums border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-muted-foreground">{estimate != null ? `${fmt(estimate)} est` : "—"}</span>
      <span className="font-medium">{actual != null ? fmt(actual) : "—"}</span>
      <span className={cn("font-medium", pct == null ? "text-muted-foreground" : pct >= 0 ? "text-emerald-500" : "text-red-500")}>
        {pct == null ? "—" : `${pct >= 0 ? "Beat" : "Missed"} ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`}
      </span>
    </div>
  );
}

function LatestReport({ r }: { r: EarningsCalendarEntry }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <div>
          <p className="text-lg font-medium">
            {r.year != null && r.quarter != null ? `${r.year} Q${r.quarter} report` : "Latest report"}
          </p>
          <p className="text-sm text-muted-foreground">
            {fmtDate(r.reportDate)}
            {bell(r.hour) ? ` · ${bell(r.hour)}` : ""}
          </p>
        </div>
        <div>
          <ReportLine label="Revenue" estimate={r.revenueEstimate} actual={r.revenueActual} fmt={money} />
          <ReportLine label="EPS" estimate={r.epsEstimate} actual={r.epsActual} fmt={(n) => `$${n.toFixed(2)}`} />
        </div>
      </CardContent>
    </Card>
  );
}

export function StockEarningsSection({ symbol }: { symbol: string }) {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stocks/${encodeURIComponent(symbol)}/earnings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: EarningsResponse | null) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!data || (!data.next && !data.latest && data.recent.length === 0)) {
    return <p className="text-sm text-muted-foreground">No earnings data for {symbol}.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Quarter chips — next first, then history newest → oldest */}
      <div className="flex flex-wrap gap-1.5">
        {data.next ? (
          <span className="rounded-md border px-2 py-1 text-xs tabular-nums">
            {data.next.year != null && data.next.quarter != null
              ? `Q${data.next.quarter} ${data.next.year}`
              : "Next"}{" "}
            <span className="text-muted-foreground">
              · {fmtDate(data.next.reportDate).replace(/^\w+, /, "")}
              {bell(data.next.hour) ? ` ${bell(data.next.hour)}` : ""}
            </span>
          </span>
        ) : null}
        {data.recent.map((q) => (
          <span key={q.period} className="rounded-md border px-2 py-1 text-xs tabular-nums">
            {q.period.slice(0, 7)}{" "}
            {q.surprisePct != null ? (
              <span className={q.surprisePct >= 0 ? "text-emerald-500" : "text-red-500"}>
                {q.surprisePct >= 0 ? "+" : "−"}
                {Math.abs(q.surprisePct).toFixed(2)}%
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        ))}
      </div>

      {data.latest ? <LatestReport r={data.latest} /> : null}

      {data.next ? (
        <p className="text-sm text-muted-foreground">
          Next report {fmtDate(data.next.reportDate)}
          {bell(data.next.hour) ? ` ${bell(data.next.hour)}` : ""}
          {data.next.epsEstimate != null ? ` · street expects EPS $${data.next.epsEstimate.toFixed(2)}` : ""}
          {data.next.revenueEstimate != null ? `, revenue ${money(data.next.revenueEstimate)}` : ""}.
        </p>
      ) : null}
    </div>
  );
}
