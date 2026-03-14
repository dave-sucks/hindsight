import Link from "next/link";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { cn, pnlColor } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

// ── TradeRow ─────────────────────────────────────────────────────────────────
// Dashboard trade list item: logo, ticker + price, position value, P&L + badge.
// Used in the dashboard sidebar for open/closed positions.

interface TradeRowProps {
  /** Trade ID — used for the link */
  id: string;
  /** Stock ticker symbol */
  ticker: string;
  /** Current price per share */
  currentPrice: number;
  /** Number of shares held */
  shares?: number;
  /** P&L dollar amount */
  pnl: number;
  /** P&L percentage (shown as badge) */
  pnlPct: number;
  /** Trade status */
  status: string;
  /** Flash effect for realtime trade close animation */
  flash?: "win" | "loss";
  /** Additional class names */
  className?: string;
}

export function TradeRow({
  id,
  ticker,
  currentPrice,
  shares = 1,
  pnl,
  pnlPct,
  status,
  flash,
  className,
}: TradeRowProps) {
  const totalWorth = currentPrice * shares;

  return (
    <Link
      href={`/trades/${id}`}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 transition-colors border-b border-border/40 last:border-0",
        flash === "win" && "bg-positive/10",
        flash === "loss" && "bg-negative/10",
        className,
      )}
    >
      <StockLogo ticker={ticker} size="md" className="rounded-md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{ticker}</span>
          <span className="text-sm tabular-nums font-light">
            ${currentPrice.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatCurrency(totalWorth)} — {shares} share
            {shares !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={cn("text-sm tabular-nums", pnlColor(pnl))}>
              {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
            </span>
            <PnlBadge value={pnlPct} format="percent" className="text-xs" />
          </div>
        </div>
      </div>
    </Link>
  );
}
