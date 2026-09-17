"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { TradeRowShell } from "@/components/ui/trade-row";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MoverKind, MoversView } from "@/lib/market-data/movers";

// ─── MoversPanel — today's movers on the dashboard right rail ────────────────
//
// Same shape as PinnedPanel: an uppercase mono label, the tab pill the
// coverage table uses, and a bordered list of the app's one row shell
// (TradeRowShell) — logo, ticker, company, price, the day's move. The top
// five of each list; "See all" opens /movers on the same tab.

const TABS: { key: MoverKind; label: string }[] = [
  { key: "gainers", label: "Gainers" },
  { key: "losers", label: "Losers" },
  { key: "active", label: "Active" },
];
const SHOWN = 5;

export default function MoversPanel() {
  const [kind, setKind] = useState<MoverKind>("gainers");
  const [views, setViews] = useState<Partial<Record<MoverKind, MoversView>>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (views[kind]) return;
    let cancelled = false;
    setFailed(false);
    fetch(`/api/movers?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: MoversView) => {
        if (!cancelled) setViews((v) => ({ ...v, [kind]: json }));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, views]);

  const view = views[kind];
  const rows = view?.rows ?? [];

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Movers</p>
        <div className="flex items-center gap-0.5 rounded-md border bg-muted/50 px-1 py-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setKind(t.key)}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                kind === t.key
                  ? "bg-background text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg border overflow-hidden bg-card">
        {failed ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">Movers unavailable right now.</p>
        ) : !view ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {view.error ? `No movers — ${view.error}.` : "No movers right now."}
          </p>
        ) : (
          rows.slice(0, SHOWN).map((r) => (
            <TradeRowShell
              key={r.symbol}
              href={`/stocks/${r.symbol}`}
              leading={<StockLogo ticker={r.symbol} size="md" className="rounded-md" />}
              primary={<span className="text-sm font-medium">{r.symbol}</span>}
              trailingTop={
                <span className="text-sm tabular-nums font-light">
                  {r.price != null ? `$${r.price.toFixed(2)}` : "—"}
                </span>
              }
              secondary={r.name ?? (r.analystIds.length > 0 ? "On your book" : "")}
              trailingBottom={
                r.changePct != null ? <PnlBadge value={r.changePct} format="percent" className="text-xs" /> : undefined
              }
            />
          ))
        )}
        <div className="border-t p-1.5 flex justify-center">
          <Button variant="ghost" size="sm" render={<Link href={`/movers?tab=${kind}`} />}>
            See all
          </Button>
        </div>
      </div>
    </div>
  );
}
