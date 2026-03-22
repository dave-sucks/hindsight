import Link from "next/link";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn, pnlColor } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

// ── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline"; tooltip: string }> = {
  OPEN: {
    label: "Held",
    variant: "secondary",
    tooltip: "This position is actively held. P&L updates when the market is open.",
  },
  CLOSED: {
    label: "Closed",
    variant: "outline",
    tooltip: "This position has been exited. The P&L shown is the realized gain/loss.",
  },
  PENDING: {
    label: "Pending",
    variant: "default",
    tooltip: "Order submitted but not yet filled. Will execute at the next market open.",
  },
};

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
  /** Trade status (OPEN, CLOSED, PENDING) */
  status: string;
  /** Trade direction (LONG, SHORT) */
  direction?: string;
  /** When the position was opened */
  openedAt?: Date;
  /** Trade outcome (WIN, LOSS) — only for closed trades */
  outcome?: string | null;
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
  direction,
  openedAt,
  outcome,
  flash,
  className,
}: TradeRowProps) {
  const totalWorth = currentPrice * shares;
  const statusConfig = STATUS_CONFIG[status] ?? STATUS_CONFIG.OPEN;

  // Format date compactly
  const dateStr = openedAt
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
        openedAt instanceof Date ? openedAt : new Date(openedAt),
      )
    : null;

  // If P&L is exactly 0 and status is OPEN, it might be stale (no live data)
  const isStalePrice = status === "OPEN" && pnl === 0 && pnlPct === 0;

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
            {direction && (
              <span className={cn(
                "text-[9px] font-medium uppercase",
                direction === "LONG" ? "text-emerald-500" : "text-red-500",
              )}>
                {direction}
              </span>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge variant={statusConfig.variant} className="text-[8px] px-1 py-0 h-3.5 leading-none cursor-default">
                      {statusConfig.label}
                    </Badge>
                  }
                />
                <TooltipContent side="top">
                  {statusConfig.tooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {outcome && status === "CLOSED" && (
              <span className={cn(
                "text-[9px] font-medium",
                outcome === "WIN" ? "text-emerald-500" : "text-red-500",
              )}>
                {outcome}
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
            {isStalePrice ? (
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
