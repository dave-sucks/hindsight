"use client";

/**
 * Today's movers as a table — Gainers / Losers / Active, sortable by any
 * column. Built from the same pieces as the dashboard's coverage table (the
 * tab pill, the bordered Table, logo + name cell, PnlBadge for the move) and
 * the earnings rows' send-to-analyst dropdown. Live on each tab switch;
 * nothing stored.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StockLogo } from "@/components/StockLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MoverEntry, MoverKind, MoversView } from "@/lib/market-data/movers";

const TABS: { key: MoverKind; label: string }[] = [
  { key: "gainers", label: "Gainers" },
  { key: "losers", label: "Losers" },
  { key: "active", label: "Active" },
];

type SortKey = "changePct" | "price" | "volume";

function fmtVolume(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

/** Each tab's natural order: gainers by biggest rise, losers by biggest fall, active by volume. */
function defaultSort(kind: MoverKind): { key: SortKey; desc: boolean } {
  if (kind === "losers") return { key: "changePct", desc: false };
  if (kind === "active") return { key: "volume", desc: true };
  return { key: "changePct", desc: true };
}

export function MoversTable({
  analysts,
  initialKind = "gainers",
}: {
  analysts: Array<{ id: string; name: string }>;
  initialKind?: MoverKind;
}) {
  const [kind, setKind] = useState<MoverKind>(initialKind);
  const [view, setView] = useState<MoversView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [sort, setSort] = useState(defaultSort(initialKind));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(null);
    fetch(`/api/movers?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: MoversView) => {
        if (!cancelled) setView(json);
      })
      .catch((e: unknown) => {
        if (!cancelled) setFailed(e instanceof Error ? e.message : "Couldn't load movers");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const rows = useMemo(() => {
    const list = [...(view?.kind === kind ? view.rows : [])];
    const val = (r: MoverEntry) => r[sort.key] ?? (sort.desc ? -Infinity : Infinity);
    return list.sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)));
  }, [view, kind, sort]);

  const switchTab = (k: MoverKind) => {
    setKind(k);
    setSort(defaultSort(k));
  };
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? " ↓" : " ↑") : "");

  return (
    <div className="space-y-3">
      <div className="flex w-fit items-center gap-0.5 rounded-md border bg-muted/50 px-1 py-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={cn(
              "px-2.5 py-1 text-xs rounded transition-colors",
              kind === t.key
                ? "bg-background text-foreground font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {failed ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Movers unavailable — {failed}.</p>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="rounded-lg border overflow-hidden bg-card">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-3.5 w-48" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {view?.error ? `No movers — ${view.error}.` : "No movers right now."}
          </p>
        </div>
      ) : (
        <div className={cn("rounded-lg border overflow-hidden bg-card", loading && "opacity-60")}>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-24 text-right">
                  <button onClick={() => sortBy("price")}>Price{arrow("price")}</button>
                </TableHead>
                <TableHead className="w-24 text-right">
                  <button onClick={() => sortBy("changePct")}>1D{arrow("changePct")}</button>
                </TableHead>
                <TableHead className="hidden md:table-cell w-28 text-right">
                  <button onClick={() => sortBy("volume")}>Volume{arrow("volume")}</button>
                </TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.symbol}>
                  <TableCell>
                    <Link href={`/stocks/${r.symbol}`} className="flex items-center gap-2 min-w-0">
                      <StockLogo ticker={r.symbol} size="md" className="rounded-md" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate">{r.name ?? r.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          <span className="tabular-nums">{r.symbol}</span>
                          {r.exchange ? ` · ${r.exchange}` : ""}
                          {r.analystIds.length > 0 ? " · On your book" : ""}
                        </span>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums font-light">
                    {r.price != null ? `$${r.price.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.changePct != null ? (
                      <PnlBadge value={r.changePct} format="percent" className="text-xs" />
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right text-sm tabular-nums font-light">
                    {fmtVolume(r.volume)}
                  </TableCell>
                  <TableCell className="text-right">
                    <WatchlistDropdown
                      symbol={r.symbol}
                      analysts={analysts.map((a) => ({ ...a, isWatched: r.analystIds.includes(a.id) }))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Common stock at $5 and up. Volume is the consolidated tape, about 16 minutes behind
        {view && !view.hasVolume ? " — unavailable right now" : ""}.
      </p>
    </div>
  );
}
