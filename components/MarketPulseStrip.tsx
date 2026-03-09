"use client";

import { cn } from "@/lib/utils";
import { useMarketPulse } from "@/hooks/useMarketPulse";

interface Props {
  /** Tickers for open trades — added to WebSocket subscription dynamically */
  openTradeTickers?: string[];
  /** Whether market is currently open — passed from server so no client-side calc needed */
  marketOpen: boolean;
}

// ── Skeleton for a ticker item before first price arrives ─────────────────────

function TickerSkeleton({ symbol }: { symbol: string }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 animate-pulse">
      <span className="text-xs font-medium text-muted-foreground hidden sm:block">
        {symbol}
      </span>
      <span className="h-3 w-14 bg-muted rounded" />
      <span className="h-3 w-10 bg-muted rounded" />
    </div>
  );
}

// ── Market status pill ────────────────────────────────────────────────────────

function MarketStatusPill({ open }: { open: boolean }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {open ? (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      ) : (
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
      )}
      <span
        className={cn(
          "text-xs font-medium tabular-nums",
          open ? "text-emerald-500" : "text-muted-foreground"
        )}
      >
        {open ? "OPEN" : "CLOSED"} · {dateStr}
      </span>
    </div>
  );
}

// ── Main strip ────────────────────────────────────────────────────────────────

export default function MarketPulseStrip({
  openTradeTickers = [],
  marketOpen,
}: Props) {
  const { quotes, tickers } = useMarketPulse(openTradeTickers);

  return (
    <div className="h-9 flex items-center gap-5 border-b px-4 overflow-x-auto bg-background shrink-0">
      {tickers.map((symbol) => {
        const q = quotes[symbol];
        if (!q || q.price === 0) {
          return <TickerSkeleton key={symbol} symbol={symbol} />;
        }

        const positive = q.changePct >= 0;
        const priceStr =
          symbol === "BTC-USD" || symbol === "ETH-USD"
            ? q.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
            : q.price.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
        const label = symbol === "BTC-USD" ? "BTC" : symbol === "ETH-USD" ? "ETH" : symbol;

        return (
          <div key={symbol} className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-medium text-muted-foreground hidden sm:block">
              {label}
            </span>
            {/* Price — flashes color on tick */}
            <span
              className={cn(
                "text-xs font-medium tabular-nums transition-colors duration-300",
                q.flash === "up" && "text-emerald-400",
                q.flash === "down" && "text-red-400",
                !q.flash && "text-foreground"
              )}
            >
              {priceStr}
            </span>
            {/* % change — persistent color */}
            <span
              className={cn(
                "text-xs tabular-nums font-medium",
                positive ? "text-emerald-500" : "text-red-500"
              )}
            >
              {positive ? "+" : ""}
              {q.changePct.toFixed(2)}%
            </span>
          </div>
        );
      })}

      <div className="ml-auto pl-4">
        <MarketStatusPill open={marketOpen} />
      </div>
    </div>
  );
}
