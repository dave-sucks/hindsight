import Link from "next/link";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, pnlColor } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

// ── TradeRow ─────────────────────────────────────────────────────────────────
// Compact trade list item: logo, ticker + price, position value, P&L + badge.
// Used everywhere: dashboard sidebar, analyst detail, anywhere trades are listed.
//
// Status semantics (the thing that was confusing):
//   "OPEN"     — Alpaca order filled, paper shares are held. The "Holding" pill.
//   "PENDING"  — Order submitted to Alpaca but no fill yet (e.g. after-hours).
//                Renders an amber "Pending fill" pill.
//   anything else (CLOSED_*) — closed position, no badge.
//
// Price freshness:
//   priceSource === "missing" → live quote unavailable; we render an amber
//   "no live price" indicator instead of fake "+$0.00" P&L.

interface TradeRowProps {
  id: string;
  ticker: string;
  currentPrice: number;
  entryPrice?: number;
  shares?: number;
  pnl: number;
  pnlPct: number;
  status: string;
  openedAt?: Date | string;
  placedAt?: string;
  filledAt?: string;
  priceSource?: "alpaca" | "finnhub" | "missing";
  priceUpdatedAt?: string;
  alpacaOrderId?: string;
  flash?: "win" | "loss";
  className?: string;
}

function fmtExact(d: string | Date): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtShort(d: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    d instanceof Date ? d : new Date(d),
  );
}

export function TradeRow({
  id,
  ticker,
  currentPrice,
  entryPrice,
  shares = 1,
  pnl,
  pnlPct,
  status,
  openedAt,
  placedAt,
  filledAt,
  priceSource,
  priceUpdatedAt,
  alpacaOrderId,
  flash,
  className,
}: TradeRowProps) {
  const totalWorth = currentPrice * shares;
  const dateStr = openedAt ? fmtShort(openedAt) : null;

  const isPending = status === "PENDING";
  const isOpen = status === "OPEN" || isPending;
  const isStalePrice = isOpen && priceSource === "missing";

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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex items-center gap-1 text-[9px] font-medium uppercase text-amber-500 cursor-default">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      Pending fill
                    </span>
                  }
                />
                <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
                  <p>Order submitted to Alpaca but not yet filled.</p>
                  {placedAt && <p>Placed {fmtExact(placedAt)}</p>}
                </TooltipContent>
              </Tooltip>
            )}
            {!isPending && status === "OPEN" && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="text-[9px] font-medium uppercase text-positive/80 cursor-default">
                      Holding
                    </span>
                  }
                />
                <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
                  <p>Paper shares held in your Alpaca account.</p>
                  {filledAt && <p>Filled {fmtExact(filledAt)}{entryPrice != null && ` @ $${entryPrice.toFixed(2)}`}</p>}
                  {alpacaOrderId && (
                    <p className="font-mono text-[10px] text-muted-foreground/70">
                      Alpaca: {alpacaOrderId.slice(0, 8)}…
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex items-center gap-1 text-sm tabular-nums font-light cursor-default">
                  {isStalePrice && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  )}
                  ${currentPrice.toFixed(2)}
                </span>
              }
            />
            <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1">
              {priceSource === "alpaca" && (
                <p>Live price via Alpaca{priceUpdatedAt && ` · ${fmtExact(priceUpdatedAt)}`}</p>
              )}
              {priceSource === "finnhub" && (
                <p>Price via Finnhub fallback{priceUpdatedAt && ` · ${fmtExact(priceUpdatedAt)}`}</p>
              )}
              {(priceSource === "missing" || priceSource === undefined) && isOpen && (
                <>
                  <p className="text-amber-500">No live price available right now.</p>
                  {entryPrice != null && (
                    <p className="text-muted-foreground">
                      Showing entry price ${entryPrice.toFixed(2)} as a placeholder.
                    </p>
                  )}
                </>
              )}
              {!isOpen && <p>Closing price.</p>}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatCurrency(totalWorth)} — {shares} share
            {shares !== 1 ? "s" : ""}
            {dateStr && <> · {dateStr}</>}
          </span>
          <div className="flex items-center gap-1.5">
            {isStalePrice ? (
              <span className="text-[10px] text-amber-500/80">no live price</span>
            ) : isPending ? (
              <span className="text-[10px] text-amber-500/80">awaiting fill</span>
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
