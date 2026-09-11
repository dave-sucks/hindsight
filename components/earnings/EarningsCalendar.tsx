"use client";

/**
 * The earnings calendar — a week strip and one day's reporters with the
 * numbers. Live from the vendor on every day change; nothing stored.
 *
 * Built on the app's own row: every reporter is a `TradeRowShell` (the
 * ONE trade-row design), inside the same card-table wrapper the dashboard
 * uses, under the same page container as Runs. Send-to-agent is the row's
 * kebab menu, one item per analyst not already on the name.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { PriceChange } from "@/components/ui/price-change";
import { TradeRowShell } from "@/components/ui/trade-row";
import { StockLogo } from "@/components/StockLogo";
import { sendToThesisWriter } from "@/lib/actions/watchlist.actions";
import { cn } from "@/lib/utils";
import type { EarningsDayView, EarningsDayRow } from "@/lib/market-data/earnings-calendar";

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function bell(hour: string | null): string | null {
  return hour === "bmo" ? "before open" : hour === "amc" ? "after close" : null;
}

function pctOf(actual: number | null, estimate: number | null): number | null {
  if (actual == null || estimate == null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

/** "EPS $1.92 vs $1.78 est · Rev $19.34B vs $19.53B est, missed" */
function Figures({ row }: { row: EarningsDayRow }) {
  const parts: React.ReactNode[] = [];
  if (row.epsActual != null) {
    parts.push(
      <span key="eps">
        EPS ${row.epsActual.toFixed(2)}
        {row.epsEstimate != null ? ` vs $${row.epsEstimate.toFixed(2)} est` : ""}
      </span>,
    );
  } else if (row.epsEstimate != null) {
    parts.push(<span key="eps">EPS est ${row.epsEstimate.toFixed(2)}</span>);
  }
  if (row.revenueActual != null) {
    const p = pctOf(row.revenueActual, row.revenueEstimate);
    parts.push(
      <span key="rev">
        Rev {money(row.revenueActual)}
        {row.revenueEstimate != null ? ` vs ${money(row.revenueEstimate)} est` : ""}
        {p != null ? (
          <span className={cn("ml-1", p >= 0 ? "text-positive" : "text-negative")}>
            {p >= 0 ? "beat" : "missed"}
          </span>
        ) : null}
      </span>,
    );
  } else if (row.revenueEstimate != null) {
    parts.push(<span key="rev">Rev est {money(row.revenueEstimate)}</span>);
  }
  const when = bell(row.hour);
  if (row.epsActual == null && when) parts.push(<span key="when">{when}</span>);
  if (parts.length === 0) return <>—</>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? <span className="mx-1 text-muted-foreground/40">·</span> : null}
          {p}
        </span>
      ))}
    </>
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
  const menuItems = analysts
    .filter((a) => !row.analystIds.includes(a.id))
    .map((a) => ({
      label: `Send to ${a.name}`,
      onSelect: () => {
        sendToThesisWriter(a.id, row.symbol, "horizon")
          .then(() => toast.success(`${row.symbol} sent to ${a.name} — it lands shortly.`))
          .catch((err: unknown) =>
            toast.error(err instanceof Error ? err.message : `Couldn't send ${row.symbol}`),
          );
      },
    }));

  return (
    <TradeRowShell
      href={`/stocks/${row.symbol}`}
      leading={<StockLogo ticker={row.symbol} size="md" className="rounded-md" />}
      primary={
        <>
          <span className="text-sm font-medium">{row.symbol}</span>
          {row.companyName ? (
            <span className="text-xs text-muted-foreground truncate max-w-[14rem]">{row.companyName}</span>
          ) : null}
          {onBook ? <span className="size-1.5 rounded-full bg-primary" title="On your book" /> : null}
        </>
      }
      trailingTop={
        row.price != null ? (
          <span className="inline-flex items-center gap-1.5 text-sm tabular-nums font-light">
            ${row.price.toFixed(2)}
            {row.changePct != null ? (
              <PriceChange dollarChange={0} percentChange={row.changePct} percentOnly size="sm" />
            ) : null}
          </span>
        ) : undefined
      }
      secondary={<Figures row={row} />}
      trailingBottom={
        row.surprisePct != null ? (
          <PnlBadge value={row.surprisePct} format="percent" className="text-xs" />
        ) : row.epsActual == null ? (
          <span className="text-[10px] text-muted-foreground/60">not yet reported</span>
        ) : undefined
      }
      menuItems={menuItems}
    />
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

  const today = isoDay(new Date());
  const shift = (days: number) => setDate(isoDay(new Date(utc(date).getTime() + days * DAY_MS)));

  // Sun..Sat around the date — from the response when we have it, else
  // computed so the strip paints before the first load returns.
  const strip =
    view?.days ??
    Array.from({ length: 7 }, (_, i) => {
      const sunday = new Date(utc(date).getTime() - utc(date).getUTCDay() * DAY_MS);
      return { date: isoDay(new Date(sunday.getTime() + i * DAY_MS)), count: 0 };
    });
  const options = strip.map((d) => ({
    value: d.date,
    label: utc(d.date).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" }),
    title: d.count > 0 ? `${d.count} report${d.count === 1 ? "" : "s"}` : "No reports",
  }));
  const selected = strip.find((d) => d.date === date);
  const dayLabel = utc(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => shift(-7)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <ChipTabs options={options} value={date} onChange={(v) => v && setDate(v)} clearable={false} />
        <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => shift(7)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setDate(today)} disabled={date === today}>
          Today
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : loading && !view ? (
        <div className="rounded-lg border overflow-hidden bg-card">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5 border-b border-border/40 last:border-0">
              <Skeleton className="size-8 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-72" />
              </div>
            </div>
          ))}
        </div>
      ) : view && view.rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No notable reports on {dayLabel}.</p>
        </div>
      ) : (
        <div className={cn("rounded-lg border overflow-hidden bg-card", loading && "opacity-60")}>
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{dayLabel}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {selected?.count ?? view?.rows.length ?? 0} reports
            </span>
          </div>
          {view?.rows.map((r) => (
            <Row key={r.symbol} row={r} analysts={analysts} />
          ))}
        </div>
      )}
    </div>
  );
}
