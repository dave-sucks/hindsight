"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TechnicalCardData = {
  ticker?: string;
  currentPrice?: number;
  rsi14?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  priceVsSma20?: string | null;
  priceVsSma50?: string | null;
  positionIn52wRange?: string | null;
  volumeRatio?: string | null;
  trend?: string | null;
};

export type TechnicalCardProps = ComponentProps<typeof Card> & TechnicalCardData;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rsiColor(rsi: number): string {
  if (rsi >= 70) return "text-red-500";
  if (rsi >= 60) return "text-amber-500";
  if (rsi <= 30) return "text-emerald-500";
  if (rsi <= 40) return "text-blue-500";
  return "text-foreground";
}

function rsiLabel(rsi: number): string {
  if (rsi >= 70) return "Overbought";
  if (rsi >= 60) return "Bullish";
  if (rsi <= 30) return "Oversold";
  if (rsi <= 40) return "Bearish";
  return "Neutral";
}

// ─── TechnicalCard — compact reasoning-style block ───────────────────────────

export function TechnicalCard({
  ticker,
  rsi14,
  sma20,
  sma50,
  priceVsSma20,
  priceVsSma50,
  positionIn52wRange,
  volumeRatio,
  trend,
  className,
  ...cardProps
}: TechnicalCardProps) {
  const isBullish = trend?.includes("bullish");
  const isBearish = trend?.includes("bearish");
  const pos52w = positionIn52wRange ? parseInt(positionIn52wRange.replace("%", "")) : null;
  const hasData = rsi14 != null || sma20 != null || sma50 != null || volumeRatio != null || pos52w != null;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Compact header row */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <span className="text-xs font-medium text-muted-foreground">Technicals</span>
        {ticker && <span className="text-xs font-mono font-medium">{ticker}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {trend && (
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] gap-1 py-0",
                isBullish && "text-emerald-500",
                isBearish && "text-red-500",
              )}
            >
              {isBullish ? <ArrowUpRight className="h-2.5 w-2.5" /> : isBearish ? <ArrowDownRight className="h-2.5 w-2.5" /> : null}
              {isBullish ? "Bullish" : isBearish ? "Bearish" : "Neutral"}
            </Badge>
          )}
        </div>
      </div>

      {/* Empty state when no data */}
      {!hasData && (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Technical data unavailable — limited price history or non-US stock.
        </div>
      )}

      {/* Compact inline metrics */}
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {rsi14 != null && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">RSI</span>
            <span className={cn("tabular-nums font-semibold", rsiColor(rsi14))}>
              {rsi14.toFixed(0)}
            </span>
            <span className="text-[10px] text-muted-foreground">{rsiLabel(rsi14)}</span>
          </span>
        )}
        {sma20 != null && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">SMA20</span>
            <span className="tabular-nums font-medium">${sma20.toFixed(2)}</span>
            {priceVsSma20 && (
              <span className={cn("text-[10px]", priceVsSma20.includes("above") ? "text-emerald-500" : "text-red-500")}>
                {priceVsSma20.includes("above") ? "Above" : "Below"}
              </span>
            )}
          </span>
        )}
        {sma50 != null && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">SMA50</span>
            <span className="tabular-nums font-medium">${sma50.toFixed(2)}</span>
            {priceVsSma50 && (
              <span className={cn("text-[10px]", priceVsSma50.includes("above") ? "text-emerald-500" : "text-red-500")}>
                {priceVsSma50.includes("above") ? "Above" : "Below"}
              </span>
            )}
          </span>
        )}
        {volumeRatio && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Vol</span>
            <span
              className={cn(
                "tabular-nums font-medium",
                volumeRatio.includes("elevated") ? "text-amber-500" : "text-foreground/70",
              )}
            >
              {volumeRatio}
            </span>
          </span>
        )}
      </div>

      {/* 52-week range — tight inline bar */}
      {pos52w != null && (
        <div className="px-4 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground shrink-0">52W</span>
            <div className="relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  pos52w >= 70 ? "bg-emerald-500" : pos52w >= 30 ? "bg-amber-400" : "bg-red-500",
                )}
                style={{ width: `${Math.min(pos52w, 100)}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums font-medium shrink-0">{pos52w}%</span>
          </div>
        </div>
      )}
    </Card>
  );
}
