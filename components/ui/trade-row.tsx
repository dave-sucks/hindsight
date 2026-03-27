import Link from "next/link";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { cn, pnlColor } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

// ── TradeRow ─────────────────────────────────────────────────────────────────
// Compact trade list item: logo, ticker + price, position value, P&L + badge.
// Used everywhere: dashboard sidebar, analyst detail, anywhere trades are listed.
// Only shows "Pending" badge when order isn't filled yet. No direction or outcome badges.

interface TradeRowProps {
  id: string;
  ticker: string;
  currentPrice: number;
  shares?: number;
  pnl: number;
  pnlPct: number;
  status: string;
  openedAt?: Date;
  flash?: "win" | "loss";
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
  openedAt,
  flash,
  className,
}: TradeRowProps) {
  const totalWorth = currentPrice * shares;

  const dateStr = openedAt
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
        openedAt instanceof Date ? openedAt : new Date(openedAt),
      )
    : null;

  const isStalePrice = status === "OPEN" && pnl === 0 && pnlPct === 0;
  const isPending = status === "PENDING";

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
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{ticker}</span>
            {isPending && (
              <span className="text-[9px] font-medium text-muted-foreground uppercase">
                Pending
              </span>
            )}
          </div>
          <span className="text-sm tabular-nums font-light">
            ${currentPrice.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatCurrency(totalWorth)} — {shares} share
            {shares !== 1 ? "s" : ""}
            {dateStr && <> · {dateStr}</>}
          </span>
          <div className="flex items-center gap-1.5">
            {isPending ? (
              <span className="text-[10px] text-muted-foreground/60">awaiting fill</span>
            ) : isStalePrice ? (
              <span className="text-[10px] text-muted-foreground/60">awaiting price</span>
            ) : (
              <>
                <span className={cn("text-sm tabular-nums", pnlColor(pnl))}>
                  {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
                </span>
                <PnlBadge value={pnlPct} format="percent" className="text-xs" />
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
