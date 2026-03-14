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
    dotClass: "bg-positive animate-pulse",
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
  const dirColor = isLong ? "text-positive" : "text-negative";
  const DirIcon = isLong ? ArrowUpRight : ArrowDownRight;
  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.OPEN;
  const isClosed = status === "CLOSED";

  const pnlPct =
    isClosed && closePrice != null
      ? ((closePrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1)
      : null;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="px-5 py-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold font-mono">{ticker}</span>
          <Badge
            variant="secondary"
            className={cn(
              "gap-1 text-xs font-semibold",
              dirColor,
              isLong ? "bg-positive/10" : "bg-negative/10"
            )}
          >
            <DirIcon className="h-3.5 w-3.5" />
            {direction}
          </Badge>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <div
              className={cn("h-2 w-2 rounded-full", statusCfg.dotClass)}
            />
            <span className="text-xs text-muted-foreground font-medium">
              {statusCfg.label}
            </span>
          </div>
          {outcome && (
            <Badge
              variant="secondary"
              className={cn(
                "text-xs font-semibold",
                outcome === "WIN" && "bg-positive/10 text-positive",
                outcome === "LOSS" && "bg-negative/10 text-negative",
                outcome === "BREAKEVEN" && "text-muted-foreground"
              )}
            >
              {outcome}
            </Badge>
          )}
        </div>
      </div>

      {/* ── Price grid ───────────────────────────────────────────────── */}
      <div className="px-5 py-4">
        <div
          className={cn(
            "grid gap-3 rounded-xl bg-muted/40 p-4 text-center",
            isClosed ? "grid-cols-4" : "grid-cols-3"
          )}
        >
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Entry
            </p>
            <p className="text-base tabular-nums font-bold">
              ${entryPrice.toFixed(2)}
            </p>
          </div>

          {shares != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Shares
              </p>
              <p className="text-base tabular-nums font-bold">{shares}</p>
            </div>
          )}

          {targetPrice != null && !isClosed && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Target
              </p>
              <p className="text-base tabular-nums font-bold text-positive">
                ${targetPrice.toFixed(2)}
              </p>
            </div>
          )}

          {stopLoss != null && !isClosed && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Stop
              </p>
              <p className="text-base tabular-nums font-bold text-negative">
                ${stopLoss.toFixed(2)}
              </p>
            </div>
          )}

          {isClosed && closePrice != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Exit
              </p>
              <p className="text-base tabular-nums font-bold">
                ${closePrice.toFixed(2)}
              </p>
            </div>
          )}

          {isClosed && realizedPnl != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                P&L
              </p>
              <div className="flex items-center justify-center gap-1.5">
                <span
                  className={cn(
                    "text-base tabular-nums font-bold",
                    realizedPnl >= 0 ? "text-positive" : "text-negative"
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
