"use client";

/**
 * One company's earnings — the stock page's Earnings tab. Quarter chips
 * with the surprise, then the latest report as the same stat grid the
 * Financials tab uses (estimate · actual · verdict, and the tape's
 * reaction), then the next date. Live from the vendor; nothing stored.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { surprisePct } from "@/lib/agent/triggers/earnings";
import type { EarningsResponse } from "@/lib/types/thesis-sheet";

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
    ...opts,
  });
}

function bell(hour: string | null): string {
  return hour === "bmo" ? "before open" : hour === "amc" ? "after close" : "";
}

/** The one surprise formula — tiny estimates come back null, by design. */
function pctOf(actual: number | null, estimate: number | null): number | null {
  return actual == null ? null : surprisePct(actual, estimate);
}

/** The Financials tab's stat cell, verbatim, plus an optional color. */
function StatCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium tabular-nums text-foreground truncate", className)}>{value}</span>
    </div>
  );
}

function verdict(pct: number | null): { text: string; className: string } {
  if (pct == null) return { text: "—", className: "text-muted-foreground" };
  return {
    text: `${pct >= 0 ? "Beat" : "Missed"} ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`,
    className: pct >= 0 ? "text-positive" : "text-negative",
  };
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
      <div className="space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!data || (!data.next && !data.latest && data.recent.length === 0)) {
    return <p className="text-sm text-muted-foreground">No earnings data for {symbol}.</p>;
  }

  const latest = data.latest;
  const eps = latest ? verdict(pctOf(latest.epsActual, latest.epsEstimate)) : null;
  const rev = latest ? verdict(pctOf(latest.revenueActual, latest.revenueEstimate)) : null;

  return (
    <div className="space-y-4">
      {/* Quarter chips — next first, then history newest → oldest */}
      <div className="flex flex-wrap gap-1.5">
        {data.next ? (
          <Badge variant="outline" className="font-normal tabular-nums">
            {data.next.year != null && data.next.quarter != null ? `Q${data.next.quarter} ${data.next.year}` : "Next"}
            <span className="text-muted-foreground">· {fmtDate(data.next.reportDate, { year: undefined })}</span>
          </Badge>
        ) : null}
        {data.recent.map((q) => (
          <Badge key={q.period} variant="outline" className="font-normal tabular-nums">
            {q.period.slice(0, 7)}
            {q.surprisePct != null ? (
              <span className={q.surprisePct >= 0 ? "text-positive" : "text-negative"}>
                {q.surprisePct >= 0 ? "+" : "−"}
                {Math.abs(q.surprisePct).toFixed(2)}%
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Badge>
        ))}
      </div>

      {latest ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              {latest.year != null && latest.quarter != null ? `Q${latest.quarter} ${latest.year} report` : "Latest report"}
            </p>
            <p className="text-xs text-muted-foreground">
              {fmtDate(latest.reportDate, { weekday: "short" })}
              {bell(latest.hour) ? ` · ${bell(latest.hour)}` : ""}
            </p>
          </div>
          {/* Same grid as the Financials tab: estimate · actual · verdict */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 py-3 border-y">
            <StatCell label="Revenue est" value={latest.revenueEstimate != null ? money(latest.revenueEstimate) : "—"} />
            <StatCell label="Revenue" value={latest.revenueActual != null ? money(latest.revenueActual) : "—"} />
            <StatCell label="Revenue surprise" value={rev!.text} className={rev!.className} />
            <StatCell label="EPS est" value={latest.epsEstimate != null ? `$${latest.epsEstimate.toFixed(2)}` : "—"} />
            <StatCell label="EPS" value={latest.epsActual != null ? `$${latest.epsActual.toFixed(2)}` : "—"} />
            <StatCell label="EPS surprise" value={eps!.text} className={eps!.className} />
          </div>
        </div>
      ) : null}

      {data.next ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          Next report {fmtDate(data.next.reportDate, { weekday: "short" })}
          {bell(data.next.hour) ? ` ${bell(data.next.hour)}` : ""}
          {data.next.epsEstimate != null ? ` · street expects EPS $${data.next.epsEstimate.toFixed(2)}` : ""}
          {data.next.revenueEstimate != null ? `, revenue ${money(data.next.revenueEstimate)}` : ""}.
        </p>
      ) : null}
    </div>
  );
}
