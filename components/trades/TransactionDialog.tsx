"use client";

/**
 * One fill, in a dialog: what a Transactions row opens. The dollars (or the
 * position's result, on its closing fill) large at the top, when and who
 * under it, the facts as label / value rows, the reason it was proposed, and
 * a way to the thesis's sheet. It replaced the trade page's Trade Details
 * card (2026-11-04); since 2026-11-05 it is one fill, not one position.
 */

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PriceChange } from "@/components/ui/price-change";
import { humanizeCloseReason } from "@/components/domain/trade-summary";
import { formatCurrency } from "@/lib/format";
import { fmtQty } from "@/lib/trade-statement";
import { fillSentence, fillVerb, type FillFacts } from "@/lib/stocks/stock-history";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

const ORDER_WORD: Record<string, string> = { OPEN: "Buy", ADD: "Add", PARTIAL_CLOSE: "Trim", CLOSE: "Sell" };

export function TransactionDialog({
  ticker,
  fill,
  onClose,
  onOpenThesis,
}: {
  ticker: string;
  /** The open fill; null closes the dialog. */
  fill: FillFacts | null;
  onClose: () => void;
  /** Given, the footer offers the thesis's sheet. */
  onOpenThesis?: (thesisId: string) => void;
}) {
  const f = fill;
  const proposed = f?.status === "AWAITING_APPROVAL";
  const dollars = f && f.price != null ? f.price * f.quantity : null;
  const exit = f ? humanizeCloseReason(f.closeReason) : null;
  const rows: Array<{ label: string; value: string }> = !f
    ? []
    : [
        { label: "Order", value: `${ORDER_WORD[f.intent ?? ""] ?? (f.side === "SELL" ? "Sell" : "Buy")}${proposed ? ", waiting for your answer" : ""}` },
        { label: "Shares", value: fmtQty(f.quantity) },
        ...(f.price != null ? [{ label: "Price", value: formatCurrency(f.price) }] : []),
        ...(dollars != null ? [{ label: "Dollars", value: formatCurrency(dollars) }] : []),
        { label: proposed ? "Proposed" : "Filled", value: fmtDateTime(f.at) },
        ...(exit ? [{ label: "Exit", value: exit }] : []),
        { label: "Direction", value: f.direction },
        ...(f.analyst ? [{ label: "Analyst", value: f.analyst.name }] : []),
      ];

  return (
    <Dialog open={f != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        {f ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {fillVerb(f).label === "Proposal" ? fillSentence(f) : `${fillSentence(f).split(" at ")[0]} of ${ticker}`}
              </DialogTitle>
              <DialogDescription>
                {fmtDateTime(f.at)}
                {f.analyst ? ` · ${f.analyst.name}` : ""}
              </DialogDescription>
            </DialogHeader>
            {/* The one number: the position's result on its closing fill, the dollars on every other. */}
            {f.result ? (
              <PriceChange dollarChange={f.result.dollar} percentChange={f.result.pct} size="xl" />
            ) : dollars != null ? (
              <p className="text-2xl font-semibold tabular-nums">{formatCurrency(dollars)}</p>
            ) : null}
            <div>
              {rows.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between border-b border-border py-1.5 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
                </div>
              ))}
            </div>
            {f.rationale?.trim() ? <p className="text-sm font-light leading-relaxed text-foreground">{f.rationale.trim()}</p> : null}
            {onOpenThesis && f.thesisId ? (
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => onOpenThesis(f.thesisId!)}>
                  Open the thesis
                </Button>
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
