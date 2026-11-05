"use client";

/**
 * The Transactions tab: every fill on the stock (or on a thesis's trades),
 * as the stock history's rows — the buy, each add, each trim, the sale with
 * the position's result — and a dialog with one fill's facts when a row is
 * clicked. The same tab on the stock page, the trade page and the sheet (the
 * owner's design, 2026-11-04; per fill since 2026-11-05). On a page the
 * dialog can open the fill's thesis as a sheet.
 */

import { useMemo, useState } from "react";
import { StockHistory } from "@/components/stocks/StockHistory";
import { TransactionDialog } from "@/components/trades/TransactionDialog";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import { fillRows, type FillFacts } from "@/lib/stocks/stock-history";

export function Transactions({
  ticker,
  fills,
  limit,
  onViewAll,
  openThesis = false,
}: {
  ticker: string;
  fills: FillFacts[];
  /** The newest few, with "View all" (the Overview's use). */
  limit?: number;
  onViewAll?: () => void;
  /** Whether the dialog offers the fill's thesis as a sheet (a page, never the sheet itself). */
  openThesis?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [thesisId, setThesisId] = useState<string | null>(null);
  const rows = useMemo(() => fillRows(fills), [fills]);
  const open = openId ? (fills.find((f) => f.id === openId) ?? null) : null;
  if (fills.length === 0) return <p className="text-sm text-muted-foreground">No trades on {ticker} yet.</p>;
  return (
    <>
      <StockHistory ticker={ticker} items={rows} limit={limit} onViewAll={onViewAll} onOpenTrade={setOpenId} />
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
    </>
  );
}
