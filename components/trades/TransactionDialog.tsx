"use client";

/**
 * One transaction, in a dialog: what a Transactions row opens. The result (or
 * the cost while we hold) large at the top, one sentence under it, then the
 * facts as label / value rows, and a link to the trade's page. It replaced
 * the trade page's Trade Details card (2026-11-04): the same facts, where
 * the row is, not pinned beside every tab.
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PriceChange } from "@/components/ui/price-change";
import { humanizeCloseReason } from "@/components/domain/trade-summary";
import { formatCurrency } from "@/lib/format";
import { fmtQty } from "@/lib/trade-statement";
import type { TransactionFacts } from "@/lib/stocks/stock-history";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

function daysBetween(fromIso: string, toIso: string | null): number {
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  return Math.max(0, Math.round((to - new Date(fromIso).getTime()) / 86_400_000));
}

export function TransactionDialog({
  ticker,
  facts,
  onClose,
}: {
  ticker: string;
  /** The open transaction; null closes the dialog. */
  facts: TransactionFacts | null;
  onClose: () => void;
}) {
  const p = facts;
  const closed = p?.status === "CLOSED";
  const proposal = p?.status === "PENDING_APPROVAL";
  const shares = p ? `${fmtQty(p.quantity)} ${p.quantity === 1 ? "share" : "shares"}` : "";
  const cost = p ? p.avgCost * p.quantity : 0;
  const verb = !p ? "" : proposal ? (p.direction === "SHORT" ? "Short" : "Buy") : p.direction === "SHORT" ? "Shorted" : "Bought";
  const title = !p ? "" : closed ? `Sold ${shares} of ${ticker}` : `${verb} ${shares} of ${ticker}`;
  const when = !p ? "" : closed && p.closedAt ? `${fmtDateTime(p.closedAt)} · held ${daysBetween(p.openedAt, p.closedAt)} days` : `${fmtDateTime(p.openedAt)} · ${proposal ? "waiting for your answer" : `held ${daysBetween(p.openedAt, null)} days`}`;
  const exit = p ? humanizeCloseReason(p.closeReason) : null;
  const rows: Array<{ label: string; value: string }> = !p
    ? []
    : [
        { label: "Shares", value: fmtQty(p.quantity) },
        { label: "Avg entry", value: formatCurrency(p.avgCost) },
        { label: "Cost basis", value: formatCurrency(cost) },
        { label: proposal ? "Proposed" : "Opened", value: fmtDateTime(p.openedAt) },
        ...(closed && p.closePrice != null ? [{ label: "Sold at", value: formatCurrency(p.closePrice) }] : []),
        ...(closed && p.closedAt ? [{ label: "Closed", value: fmtDateTime(p.closedAt) }] : []),
        ...(exit ? [{ label: "Exit", value: exit }] : []),
        { label: "Direction", value: p.direction },
        ...(p.analyst ? [{ label: "Analyst", value: p.analyst.name }] : []),
      ];

  return (
    <Dialog open={p != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        {p ? (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{when}</DialogDescription>
            </DialogHeader>
            {/* The one number: the result once sold, the cost while we hold. */}
            {closed && p.realizedPnl != null ? (
              <PriceChange dollarChange={p.realizedPnl} percentChange={cost > 0 ? (p.realizedPnl / cost) * 100 : null} size="xl" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">{formatCurrency(cost)}</p>
            )}
            <div>
              {rows.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between border-b border-border py-1.5 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/trades/${p.id}`} />}>
                Open the trade
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
