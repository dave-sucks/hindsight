"use client";

/**
 * The Transactions tab: every trade on the stock (or the one trade of a
 * thesis), as the stock history's rows — the buy, and the sale with its
 * result — and a dialog with the facts when a row is clicked. The same tab
 * on the stock page, the trade page and the sheet (the owner's design,
 * 2026-11-04).
 */

import { useMemo, useState } from "react";
import { StockHistory } from "@/components/stocks/StockHistory";
import { TransactionDialog } from "@/components/trades/TransactionDialog";
import { transactionRows, type TransactionFacts } from "@/lib/stocks/stock-history";

export function Transactions({
  ticker,
  facts,
  limit,
  onViewAll,
}: {
  ticker: string;
  facts: TransactionFacts[];
  /** The newest few, with "View all" (the Overview's use). */
  limit?: number;
  onViewAll?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => transactionRows(facts), [facts]);
  const open = openId ? (facts.find((f) => f.id === openId) ?? null) : null;
  if (facts.length === 0) return <p className="text-sm text-muted-foreground">No trades on {ticker} yet.</p>;
  return (
    <>
      <StockHistory ticker={ticker} items={rows} limit={limit} onViewAll={onViewAll} onOpenTrade={setOpenId} />
      <TransactionDialog ticker={ticker} facts={open} onClose={() => setOpenId(null)} />
    </>
  );
}
