"use client";

/**
 * The earnings calendar — a week of day boxes and one day's reporters.
 * Live from the vendor on every day change; nothing stored.
 *
 * Shape follows the Perplexity Finance earnings view, in this app's tokens:
 * a header line with the week controls at the right, seven equal day boxes
 * that fill the width, then a card of reporters divided by hairlines —
 * logo, company name over ticker, the quarter pill at the right, and two
 * quiet lines of numbers underneath (EPS, revenue) each ending in its own
 * beat / missed verdict. Send-to-agent is the stock page's own bookmark
 * dropdown, one item per analyst.
 *
 * An Earnings | Filings toggle swaps the list for the week's SEC filings —
 * your names first, then material and serious filings of listed companies —
 * over the same week strip. A week of filings is one fetch; clicking between
 * its days doesn't search again.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChange } from "@/components/ui/price-change";
import { StockLogo } from "@/components/StockLogo";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import { cn } from "@/lib/utils";
import { surprisePct } from "@/lib/agent/triggers/earnings";
import type { EarningsDayView, EarningsDayRow } from "@/lib/market-data/earnings-calendar";
import type { FilingsDayRow, FilingsWeekView } from "@/lib/market-data/sec-filings";
import { describeFilingEvent } from "@/lib/market-data/sec-events";

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
  return hour === "bmo" ? "Before open" : hour === "amc" ? "After close" : null;
}

/** The one surprise formula — tiny estimates come back null, by design. */
function pctOf(actual: number | null, estimate: number | null): number | null {
  return actual == null ? null : surprisePct(actual, estimate);
}

/** One quiet line: "EPS   $0.22 est   $0.79   Beat +265.57%" */
function FigureLine({
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
  if (estimate == null && actual == null) return null;
  const pct = pctOf(actual, estimate);
  return (
    <div className="flex items-baseline gap-3 text-xs tabular-nums">
      <span className="w-9 text-muted-foreground">{label}</span>
      <span className="text-muted-foreground">{estimate != null ? `${fmt(estimate)} est` : "—"}</span>
      {actual != null ? (
        <>
          <span className="text-foreground">{fmt(actual)}</span>
          {pct != null ? (
            <span className={pct >= 0 ? "text-positive" : "text-negative"}>
              {pct >= 0 ? "Beat" : "Missed"} {pct >= 0 ? "+" : "−"}
              {Math.abs(pct).toFixed(2)}%
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
  const quarter =
    row.year != null && row.quarter != null ? `Q${row.quarter} ${row.year}` : null;
  const when = bell(row.hour);
  return (
    <div className="flex gap-3 px-4 py-4 border-b border-border/40 last:border-0 hover:bg-accent/30 transition-colors group">
      <Link href={`/stocks/${row.symbol}`} className="shrink-0 pt-0.5">
        <StockLogo ticker={row.symbol} size="md" className="rounded-md" />
      </Link>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/stocks/${row.symbol}`} className="block text-sm font-medium truncate hover:underline">
              {row.companyName ?? row.symbol}
            </Link>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono">{row.symbol}</span>
              {onBook ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span>On your book</span>
                </>
              ) : null}
              {row.price != null ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="tabular-nums">${row.price.toFixed(2)}</span>
                  {row.changePct != null ? (
                    <PriceChange dollarChange={0} percentChange={row.changePct} percentOnly size="sm" />
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="secondary" className="font-normal tabular-nums">
              {[quarter, when].filter(Boolean).join(" · ") || (reported ? "Reported" : "Scheduled")}
            </Badge>
            <WatchlistDropdown
              symbol={row.symbol}
              analysts={analysts.map((a) => ({ ...a, isWatched: row.analystIds.includes(a.id) }))}
            />
          </div>
        </div>
        {reported ? (
          <div className="space-y-1">
            <FigureLine label="EPS" estimate={row.epsEstimate} actual={row.epsActual} fmt={(n) => `$${n.toFixed(2)}`} />
            <FigureLine label="Rev" estimate={row.revenueEstimate} actual={row.revenueActual} fmt={money} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground tabular-nums">
            Not yet reported
            {row.epsEstimate != null ? ` · street expects EPS $${row.epsEstimate.toFixed(2)}` : ""}
            {row.revenueEstimate != null ? `, revenue ${money(row.revenueEstimate)}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

const FILING_TIER: Record<FilingsDayRow["tier"], { label: string; variant: "destructive" | "secondary" } | null> = {
  RED: { label: "Serious", variant: "destructive" },
  MATERIAL: { label: "Material", variant: "secondary" },
  CONTEXT: null,
};

function FilingRow({
  row,
  analysts,
}: {
  row: FilingsDayRow;
  analysts: Array<{ id: string; name: string }>;
}) {
  const tier = FILING_TIER[row.tier];
  const holders = row.rootForm === "SCHEDULE 13D" && row.filers.length ? row.filers.join(", ") : null;
  return (
    <div className="flex gap-3 px-4 py-4 border-b border-border/40 last:border-0 hover:bg-accent/30 transition-colors group">
      <Link href={`/stocks/${row.ticker}`} className="shrink-0 pt-0.5">
        <StockLogo ticker={row.ticker} size="md" className="rounded-md" />
      </Link>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/stocks/${row.ticker}`} className="block text-sm font-medium truncate hover:underline">
              {row.companyName}
            </Link>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="tabular-nums">{row.ticker}</span>
              {row.analystIds.length > 0 ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span>On your book</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {tier ? <Badge variant={tier.variant}>{tier.label}</Badge> : null}
            <WatchlistDropdown
              symbol={row.ticker}
              analysts={analysts.map((a) => ({ ...a, isWatched: row.analystIds.includes(a.id) }))}
            />
          </div>
        </div>
        <a href={row.url} target="_blank" rel="noopener noreferrer" className="block text-xs text-foreground hover:underline">
          {describeFilingEvent(row)}
          {holders ? <span className="text-muted-foreground"> · {holders}</span> : null}
        </a>
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
  const [mode, setMode] = useState<"earnings" | "filings">("earnings");
  const [filings, setFilings] = useState<FilingsWeekView | null>(null);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [filingsError, setFilingsError] = useState<string | null>(null);

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

  // Filings: one fetch per week. A day inside the loaded week is a filter.
  const weekStartOf = (d: string) => isoDay(new Date(utc(d).getTime() - utc(d).getUTCDay() * DAY_MS));
  const week = weekStartOf(date);
  useEffect(() => {
    if (mode !== "filings" || filings?.weekStart === week) return;
    let cancelled = false;
    setFilingsLoading(true);
    setFilingsError(null);
    fetch(`/api/filings?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: FilingsWeekView) => {
        if (cancelled) return;
        setFilings(json);
        if (json.error) setFilingsError(`SEC filings unavailable — ${json.error}`);
      })
      .catch((e: unknown) => {
        if (!cancelled) setFilingsError(e instanceof Error ? e.message : "Couldn't load filings");
      })
      .finally(() => {
        if (!cancelled) setFilingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, week, date, filings?.weekStart]);
  const filingRows = mode === "filings" && filings?.weekStart === week ? filings.rows.filter((r) => r.filedDate === date) : [];

  const today = isoDay(new Date());
  const shift = (days: number) => setDate(isoDay(new Date(utc(date).getTime() + days * DAY_MS)));

  // Sun..Sat around the date — from the response when we have it, else
  // computed so the boxes paint before the first load returns.
  const strip =
    (mode === "filings"
      ? filings?.weekStart === week
        ? filings.days
        : // Not loaded yet: -1 reads as "…", never as another view's counts.
          Array.from({ length: 7 }, (_, i) => ({ date: isoDay(new Date(utc(week).getTime() + i * DAY_MS)), count: -1 }))
      : null) ??
    view?.days ??
    Array.from({ length: 7 }, (_, i) => {
      const sunday = new Date(utc(date).getTime() - utc(date).getUTCDay() * DAY_MS);
      return { date: isoDay(new Date(sunday.getTime() + i * DAY_MS)), count: 0 };
    });

  return (
    <div className="space-y-3">
      {/* Header line: label left, week controls right — as Perplexity. */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5 rounded-md border bg-muted/50 px-1 py-0.5">
          {(["earnings", "filings"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "px-2.5 py-1 text-xs rounded transition-colors",
                mode === m
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "earnings" ? "Earnings" : "Filings"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => shift(-7)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(today)} disabled={date === today}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => shift(7)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Seven equal day boxes, full width. */}
      <div className="grid grid-cols-7 gap-1.5">
        {strip.map((d) => {
          const dt = utc(d.date);
          const active = d.date === date;
          const isToday = d.date === today;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setDate(d.date)}
              className={cn(
                "rounded-lg border px-2 py-2 text-center transition-colors",
                active
                  ? "bg-secondary border-border"
                  : "border-border/40 hover:bg-accent/40",
              )}
            >
              <div className={cn("text-[10px] uppercase tracking-wide", active ? "text-foreground" : "text-muted-foreground")}>
                {dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                {isToday ? " · today" : ""}
              </div>
              <div className="text-sm font-medium tabular-nums">
                {dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {d.count < 0
                  ? "…"
                  : mode === "filings"
                  ? d.count > 0
                    ? `${d.count} filing${d.count === 1 ? "" : "s"}`
                    : "No filings"
                  : d.count > 0
                    ? `${d.count} report${d.count === 1 ? "" : "s"}`
                    : "No reports"}
              </div>
            </button>
          );
        })}
      </div>

      {mode === "filings" ? (
        filingsError ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">{filingsError}</p>
          </div>
        ) : filingsLoading && filings?.weekStart !== week ? (
          <div className="rounded-lg border overflow-hidden bg-card">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-3 px-4 py-4 border-b border-border/40 last:border-0">
                <Skeleton className="h-8 w-8 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
              </div>
            ))}
          </div>
        ) : filingRows.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No filings worth a look this day.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="rounded-lg border overflow-hidden bg-card">
              {filingRows.map((r) => (
                <FilingRow key={`${r.ticker}:${r.accession}`} row={r} analysts={analysts} />
              ))}
            </div>
            {filings?.truncated ? (
              <p className="text-xs text-muted-foreground">
                SEC had more filings this week than one read takes — the oldest may be missing.
              </p>
            ) : null}
          </div>
        )
      ) : error ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : loading && !view ? (
        <div className="rounded-lg border overflow-hidden bg-card">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-3 px-4 py-4 border-b border-border/40 last:border-0">
              <Skeleton className="h-8 w-8 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-72" />
              </div>
            </div>
          ))}
        </div>
      ) : view && view.rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No notable reports this day.</p>
        </div>
      ) : (
        <div className={cn("rounded-lg border overflow-hidden bg-card", loading && "opacity-60")}>
          {view?.rows.map((r) => (
            <Row key={r.symbol} row={r} analysts={analysts} />
          ))}
        </div>
      )}
    </div>
  );
}
