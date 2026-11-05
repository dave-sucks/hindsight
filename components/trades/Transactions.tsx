"use client";

/**
 * The Transactions tab: every fill on the stock (or on a thesis's trades) as
 * one table, the same columns on every row so the eye runs down them —
 * Action · Shares · Price · Amount · Gain · Date — each row its own muted,
 * rounded, hoverable card with room between rows, grouped by period. A
 * sell's gain is its price against the average cost at that moment; the
 * line above the table is the stock's total. A row opens its fill's dialog,
 * which on a page can open the fill's thesis (the owner's design,
 * 2026-11-05).
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { PriceChange } from "@/components/ui/price-change";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import { TransactionDialog } from "@/components/trades/TransactionDialog";
import { periodLabel } from "@/components/agent/sheets/thesis-timeline-utils";
import { formatCurrency } from "@/lib/format";
import { fmtQty } from "@/lib/trade-statement";
import { fillSummary, fillVerb, type FillFacts } from "@/lib/stocks/stock-history";

// Fixed-width cells so the columns line up row to row; the price and the amount
// step out at narrow widths (the card's own width, not the window's).
const ROW =
  "flex w-full items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-left text-sm tabular-nums whitespace-nowrap transition-colors hover:bg-muted/70";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Today / Yesterday / This week / the month / the year — the Activity tab's periods, so the lists read alike.
function groupByPeriod(fills: FillFacts[]) {
  const groups: { label: string; fills: FillFacts[] }[] = [];
  for (const f of fills) {
    const label = periodLabel(f.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.fills.push(f);
    else groups.push({ label, fills: [f] });
  }
  return groups;
}

export function Transactions({
  ticker,
  fills,
  limit,
  onViewAll,
  openThesis = false,
  held = null,
  currentPrice = null,
}: {
  ticker: string;
  fills: FillFacts[];
  /** The newest few, with "View all" (the Overview's use). */
  limit?: number;
  onViewAll?: () => void;
  /** Whether the dialog offers the fill's thesis as a sheet (a page, never the sheet itself). */
  openThesis?: boolean;
  /** What is still held, for the total line. */
  held?: { shares: number; avgCost: number } | null;
  currentPrice?: number | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [thesisId, setThesisId] = useState<string | null>(null);
  const shown = useMemo(() => (limit ? fills.slice(0, limit) : fills), [fills, limit]);
  const groups = useMemo(() => groupByPeriod(shown), [shown]);
  const summary = useMemo(() => fillSummary(fills), [fills]);
  const open = openId ? (fills.find((f) => f.id === openId) ?? null) : null;
  if (fills.length === 0) return <p className="text-sm text-muted-foreground">No trades on {ticker} yet.</p>;

  const unrealized = held && currentPrice != null ? (currentPrice - held.avgCost) * held.shares : null;

  return (
    <div className="@container space-y-4">
      {/* The stock's total: the sells realized, and what is still held is worth. */}
      {!limit ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground tabular-nums">
          {summary.sells} {summary.sells === 1 ? "sell" : "sells"} · realized
          <PriceChange dollarChange={summary.realized} size="sm" />
          {held ? (
            <>
              · still holding {fmtQty(held.shares)} {held.shares === 1 ? "share" : "shares"}
              {unrealized != null ? (
                <>
                  , <PriceChange dollarChange={unrealized} percentChange={held.avgCost > 0 ? (unrealized / (held.avgCost * held.shares)) * 100 : null} size="sm" />
                </>
              ) : null}
            </>
          ) : null}
        </p>
      ) : null}

      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.label} className="space-y-1.5">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/60">{group.label}</p>
            {group.fills.map((f) => {
              const { label, dotClass } = fillVerb(f);
              const amount = f.price != null ? f.price * f.quantity : null;
              return (
                <button key={f.id} type="button" className={ROW} onClick={() => setOpenId(f.id)}>
                  <span className="w-24 shrink-0">
                    <Badge variant="secondary" className="gap-1.5 font-normal">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClass)} />
                      {label}
                    </Badge>
                  </span>
                  <span className="w-20 shrink-0 text-foreground">{fmtQty(f.quantity)} {f.quantity === 1 ? "share" : "shares"}</span>
                  <span className="hidden w-24 shrink-0 text-muted-foreground @sm:inline">{f.price != null ? `@ ${formatCurrency(f.price)}` : ""}</span>
                  <span className="hidden w-24 shrink-0 text-foreground @md:inline">{amount != null ? formatCurrency(amount) : ""}</span>
                  <span className="ml-auto shrink-0">
                    {f.result ? <PriceChange dollarChange={f.result.dollar} percentChange={f.result.pct} size="sm" /> : null}
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{fmtDate(f.at)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {limit && fills.length > limit && onViewAll ? (
        <button type="button" onClick={onViewAll} className="px-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          View all {fills.length} →
        </button>
      ) : null}

      <TransactionDialog
        ticker={ticker}
        fill={open}
        onClose={() => setOpenId(null)}
        onOpenThesis={openThesis ? (id) => { setOpenId(null); setThesisId(id); } : undefined}
      />
      {thesisId ? (
        <ThesisSheet
          open
          onOpenChange={(o) => { if (!o) setThesisId(null); }}
          thesis_id={thesisId}
          ticker={ticker}
          direction={null}
        />
      ) : null}
    </div>
  );
}
