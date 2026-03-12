"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Activity, ArrowUpRight, ArrowDownRight } from "lucide-react";

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

// ─── RSI gauge helper ─────────────────────────────────────────────────────────

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

// ─── TechnicalCard ────────────────────────────────────────────────────────────

export function TechnicalCard({
  ticker,
  currentPrice,
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

  // Parse 52w position percentage
  const pos52w = positionIn52wRange
    ? parseInt(positionIn52wRange.replace("%", ""))
    : null;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-500" />
          <span className="text-sm font-semibold">
            Technical Analysis
            {ticker && (
              <span className="ml-1.5 font-mono text-muted-foreground">
                {ticker}
              </span>
            )}
          </span>
        </div>
        {trend && (
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] gap-1",
              isBullish && "text-emerald-500",
              isBearish && "text-red-500"
            )}
          >
            {isBullish ? (
              <ArrowUpRight className="h-2.5 w-2.5" />
            ) : isBearish ? (
              <ArrowDownRight className="h-2.5 w-2.5" />
            ) : null}
            {isBullish ? "Bullish" : isBearish ? "Bearish" : "Neutral"}
          </Badge>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Indicator grid */}
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-muted/40 p-4 text-center">
          {rsi14 != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                RSI (14)
              </p>
              <p
                className={cn(
                  "text-base tabular-nums font-bold",
                  rsiColor(rsi14)
                )}
              >
                {rsi14.toFixed(1)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {rsiLabel(rsi14)}
              </p>
            </div>
          )}
          {sma20 != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                SMA 20
              </p>
              <p className="text-base tabular-nums font-bold">
                ${sma20.toFixed(2)}
              </p>
              {priceVsSma20 && (
                <p
                  className={cn(
                    "text-[10px] tabular-nums",
                    priceVsSma20.includes("above")
                      ? "text-emerald-500"
                      : "text-red-500"
                  )}
                >
                  {priceVsSma20.includes("above") ? "Above" : "Below"}
                </p>
              )}
            </div>
          )}
          {sma50 != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                SMA 50
              </p>
              <p className="text-base tabular-nums font-bold">
                ${sma50.toFixed(2)}
              </p>
              {priceVsSma50 && (
                <p
                  className={cn(
                    "text-[10px] tabular-nums",
                    priceVsSma50.includes("above")
                      ? "text-emerald-500"
                      : "text-red-500"
                  )}
                >
                  {priceVsSma50.includes("above") ? "Above" : "Below"}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 52-week range bar */}
        {pos52w != null && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                52-Week Range Position
              </span>
              <span className="text-xs tabular-nums font-medium">
                {pos52w}%
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  pos52w >= 70
                    ? "bg-emerald-500"
                    : pos52w >= 30
                      ? "bg-amber-400"
                      : "bg-red-500"
                )}
                style={{ width: `${Math.min(pos52w, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>52W Low</span>
              <span>52W High</span>
            </div>
          </div>
        )}

        {/* Volume ratio */}
        {volumeRatio && (
          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
            <span className="text-xs text-muted-foreground">Volume</span>
            <span
              className={cn(
                "text-xs tabular-nums font-medium",
                volumeRatio.includes("elevated")
                  ? "text-amber-500"
                  : volumeRatio.includes("low")
                    ? "text-muted-foreground"
                    : "text-foreground"
              )}
            >
              {volumeRatio}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
