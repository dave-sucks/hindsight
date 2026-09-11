"use client";

/**
 * The earnings calendar — a week strip and one day's reporters with the
 * numbers. Live from the vendor on every day change; nothing stored.
 *
 * Our names sort first and carry the analyst's badge; every row has the
 * same "send to agent" control the watchlist uses, so a name that just
 * reported is one click from an analyst researching it.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TickerBadge } from "@/components/ui/ticker-badge";
import { PriceChange } from "@/components/ui/price-change";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import { cn } from "@/lib/utils";
import type { EarningsDayView, EarningsDayRow } from "@/lib/market-data/earnings-calendar";

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function bell(hour: string | null): string {
  return hour === "bmo" ? "Before open" : hour === "amc" ? "After close" : "";
}

/** "est $0.94 → $1.11" with the beat/miss colored. Null actual = not yet. */
function EstActual({
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
  const pct =
    actual != null && estimate != null && estimate !== 0
      ? ((actual - estimate) / Math.abs(estimate)) * 100
      : null;
  return (
    <div className="flex items-baseline gap-1.5 text-sm tabular-nums">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground w-8">
        {label}
      </span>
      <span className="text-muted-foreground">{estimate != null ? `est ${fmt(estimate)}` : "no est"}</span>
      {actual != null ? (
        <>
          <span className="text-muted-foreground/60">→</span>
          <span className="font-medium">{fmt(actual)}</span>
          {pct != null ? (
            <span className={pct >= 0 ? "text-emerald-500" : "text-red-500"}>
              {pct >= 0 ? "beat" : "missed"} {Math.abs(pct).toFixed(1)}%
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Row({
  row,
  analysts,
}: {
  row: EarningsDayRow;
  analysts: Array<{ id: string; name: string }>;
}) {
  const onBook = row.analystIds.length > 0;
  const reported = row.epsActual != null;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0">
      <Link href={`/stocks/${row.symbol}`} className="shrink-0 pt-0.5">
        <TickerBadge ticker={row.symbol} direction={row.changePct == null ? null : row.changePct >= 0 ? "up" : "down"} />
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/stocks/${row.symbol}`} className="text-sm font-medium hover:underline truncate">
            {row.companyName ?? row.symbol}
          </Link>
          {onBook ? <Badge variant="secondary">On your book</Badge> : null}
          <span className="text-xs text-muted-foreground">{bell(row.hour)}</span>
          {!reported ? <span className="text-xs text-muted-foreground">· not yet reported</span> : null}
        </div>
        <EstActual label="EPS" estimate={row.epsEstimate} actual={row.epsActual} fmt={(n) => `$${n.toFixed(2)}`} />
        <EstActual label="Rev" estimate={row.revenueEstimate} actual={row.revenueActual} fmt={money} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.price != null ? (
          <div className="text-right">
            <div className="text-sm font-medium tabular-nums">${row.price.toFixed(2)}</div>
            {row.changePct != null ? (
              <PriceChange dollarChange={0} percentChange={row.changePct} percentOnly size="sm" />
            ) : null}
          </div>
        ) : null}
        <WatchlistDropdown
          symbol={row.symbol}
          analysts={analysts.map((a) => ({ ...a, isWatched: row.analystIds.includes(a.id) }))}
        />
      </div>
    </div>
  );
}

export function EarningsCalendar({
  analysts,
  initialDate,
}: {
  analysts: Array<{ id: string; name: string }>;
  initialDate: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<EarningsDayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((d: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/earnings?date=${d}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: EarningsDayView) => setView(json))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the calendar"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const shift = (days: number) =>
    setDate(isoDay(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS)));
  const today = isoDay(new Date());

  const strip = view?.days ?? Array.from({ length: 7 }, (_, i) => {
    const anchor = new Date(`${date}T00:00:00Z`);
    const sunday = new Date(anchor.getTime() - anchor.getUTCDay() * DAY_MS);
    return { date: isoDay(new Date(sunday.getTime() + i * DAY_MS)), count: 0 };
  });

  return (
    <div className="space-y-4">
      {/* Week strip */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => shift(-7)}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="grid flex-1 grid-cols-7 gap-1.5">
          {strip.map((d) => {
            const dt = new Date(`${d.date}T00:00:00Z`);
            const active = d.date === date;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => setDate(d.date)}
                className={cn(
                  "rounded-md border px-2 py-2 text-center transition-colors",
                  active ? "bg-muted border-foreground/30" : "hover:bg-muted/50",
                  d.date === today && !active ? "border-primary/40" : "",
                )}
              >
                <div className="text-xs text-muted-foreground">
                  {dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                </div>
                <div className="text-sm font-medium">
                  {dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {d.count > 0 ? `${d.count} report${d.count === 1 ? "" : "s"}` : "—"}
                </div>
              </button>
            );
          })}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => shift(7)}>
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDate(today)} disabled={date === today}>
          Today
        </Button>
      </div>

      {/* Day list */}
      <Card>
        <CardContent className="p-6">
          {error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : loading && !view ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : view && view.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notable reports this day.</p>
          ) : (
            <div className={cn(loading ? "opacity-60" : "")}>
              {view?.rows.map((r) => (
                <Row key={r.symbol} row={r} analysts={analysts} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
