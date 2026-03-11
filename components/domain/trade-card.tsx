"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { cn } from "@/lib/utils";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ShoppingCart,
  XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TradeCardData = {
  ticker: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  shares?: number;
  status?: "OPEN" | "CLOSED" | "CANCELLED";
  outcome?: "WIN" | "LOSS" | "BREAKEVEN" | null;
  closePrice?: number | null;
  realizedPnl?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
};

export type TradeCardProps = ComponentProps<typeof Card> & TradeCardData;

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; dotClass: string; icon: typeof CheckCircle2 }
> = {
  OPEN: {
    label: "Open",
    dotClass: "bg-emerald-500 animate-pulse",
    icon: Clock,
  },
  CLOSED: { label: "Closed", dotClass: "bg-muted-foreground", icon: CheckCircle2 },
  CANCELLED: {
    label: "Cancelled",
    dotClass: "bg-muted-foreground/40",
    icon: XCircle,
  },
};

// ─── TradeCard ────────────────────────────────────────────────────────────────

export function TradeCard({
  ticker,
  direction,
  entryPrice,
  shares,
  status = "OPEN",
  outcome,
  closePrice,
  realizedPnl,
  targetPrice,
  stopLoss,
  className,
  ...cardProps
}: TradeCardProps) {
  const isLong = direction === "LONG";
  const dirColor = isLong ? "text-emerald-500" : "text-red-500";
  const DirIcon = isLong ? ArrowUpRight : ArrowDownRight;
  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.OPEN;
  const isClosed = status === "CLOSED";

  const pnlPct =
    isClosed && closePrice != null
      ? ((closePrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1)
      : null;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          <span className="text-base font-semibold font-mono">{ticker}</span>
          <span
            className={cn(
              "flex items-center gap-1 text-sm font-semibold",
              dirColor
            )}
          >
            <DirIcon className="h-3.5 w-3.5" />
            {direction}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn("h-1.5 w-1.5 rounded-full", statusCfg.dotClass)}
          />
          <span className="text-xs text-muted-foreground">
            {statusCfg.label}
          </span>
          {outcome && (
            <Badge
              variant={outcome === "WIN" ? "default" : "secondary"}
              className={cn(
                "text-[10px]",
                outcome === "WIN" && "bg-emerald-500/15 text-emerald-500",
                outcome === "LOSS" && "bg-red-500/15 text-red-500"
              )}
            >
              {outcome}
            </Badge>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <div
          className={cn(
            "grid gap-3 rounded-lg bg-muted/40 p-3 text-center",
            isClosed ? "grid-cols-4" : "grid-cols-3"
          )}
        >
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
              Entry
            </p>
            <p className="text-sm tabular-nums font-semibold">
              ${entryPrice.toFixed(2)}
            </p>
          </div>

          {shares != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Shares
              </p>
              <p className="text-sm tabular-nums font-semibold">{shares}</p>
            </div>
          )}

          {targetPrice != null && !isClosed && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Target
              </p>
              <p className="text-sm tabular-nums font-semibold text-emerald-500">
                ${targetPrice.toFixed(2)}
              </p>
            </div>
          )}

          {stopLoss != null && !isClosed && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Stop
              </p>
              <p className="text-sm tabular-nums font-semibold text-red-500">
                ${stopLoss.toFixed(2)}
              </p>
            </div>
          )}

          {isClosed && closePrice != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Exit
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${closePrice.toFixed(2)}
              </p>
            </div>
          )}

          {isClosed && realizedPnl != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                P&L
              </p>
              <div className="flex items-center justify-center gap-1">
                <span
                  className={cn(
                    "text-sm tabular-nums font-semibold",
                    realizedPnl >= 0 ? "text-emerald-500" : "text-red-500"
                  )}
                >
                  {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}
                </span>
                {pnlPct != null && <PnlBadge value={pnlPct} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
