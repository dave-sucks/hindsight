"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  Globe,
  Minus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StockCardData = {
  ticker: string;
  companyName?: string;
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
  sector?: string | null;
  marketCap?: number | null;
  exchange?: string | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  peRatio?: number | null;
  beta?: number | null;
  high52w?: number | null;
  low52w?: number | null;
  avgVolume?: number | null;
  analystConsensus?: {
    buy: number;
    hold: number;
    sell: number;
    strongBuy: number;
    strongSell: number;
  } | null;
};

export type StockCardProps = ComponentProps<typeof Card> & StockCardData;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMarketCap(val: number): string {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function formatVolume(val: number): string {
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(0)}K`;
  return val.toLocaleString();
}

// ─── StockCard ────────────────────────────────────────────────────────────────

export function StockCard({
  ticker,
  companyName,
  price,
  change,
  changePct,
  sector,
  marketCap,
  exchange,
  dayHigh,
  dayLow,
  peRatio,
  beta,
  high52w,
  low52w,
  avgVolume,
  analystConsensus,
  className,
  ...cardProps
}: StockCardProps) {
  const isPositive = (changePct ?? 0) >= 0;
  const isNegative = (changePct ?? 0) < 0;
  const ChangeIcon = isPositive
    ? ArrowUpRight
    : isNegative
      ? ArrowDownRight
      : Minus;

  const totalRatings = analystConsensus
    ? analystConsensus.strongBuy +
      analystConsensus.buy +
      analystConsensus.hold +
      analystConsensus.sell +
      analystConsensus.strongSell
    : 0;
  const buyPct =
    totalRatings > 0 && analystConsensus
      ? ((analystConsensus.strongBuy + analystConsensus.buy) / totalRatings) *
        100
      : null;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg font-semibold font-mono">{ticker}</span>
          {companyName && (
            <span className="text-sm text-muted-foreground truncate">
              {companyName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sector && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Building2 className="h-2.5 w-2.5" />
              {sector}
            </Badge>
          )}
          {exchange && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Globe className="h-2.5 w-2.5" />
              {exchange}
            </Badge>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* Price + Change */}
        {price != null && (
          <div className="flex items-end gap-3">
            <span className="text-2xl tabular-nums font-bold">
              ${price.toFixed(2)}
            </span>
            {changePct != null && (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-sm font-semibold tabular-nums",
                  isPositive ? "text-emerald-500" : "text-red-500"
                )}
              >
                <ChangeIcon className="h-4 w-4" />
                {change != null && (
                  <span>
                    {change >= 0 ? "+" : ""}
                    {change.toFixed(2)}
                  </span>
                )}
                <span>
                  ({changePct >= 0 ? "+" : ""}
                  {changePct.toFixed(2)}%)
                </span>
              </span>
            )}
          </div>
        )}

        {/* Key metrics grid */}
        <div className="grid grid-cols-4 gap-3 rounded-xl bg-muted/40 p-4 text-center">
          {marketCap != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Mkt Cap
              </p>
              <p className="text-sm tabular-nums font-semibold">
                {formatMarketCap(marketCap)}
              </p>
            </div>
          )}
          {peRatio != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                P/E
              </p>
              <p className="text-sm tabular-nums font-semibold">
                {peRatio.toFixed(1)}x
              </p>
            </div>
          )}
          {beta != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Beta
              </p>
              <p className="text-sm tabular-nums font-semibold">
                {beta.toFixed(2)}
              </p>
            </div>
          )}
          {avgVolume != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Avg Vol
              </p>
              <p className="text-sm tabular-nums font-semibold">
                {formatVolume(avgVolume)}
              </p>
            </div>
          )}
          {dayHigh != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Day High
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${dayHigh.toFixed(2)}
              </p>
            </div>
          )}
          {dayLow != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Day Low
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${dayLow.toFixed(2)}
              </p>
            </div>
          )}
          {high52w != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                52W High
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${high52w.toFixed(2)}
              </p>
            </div>
          )}
          {low52w != null && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                52W Low
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${low52w.toFixed(2)}
              </p>
            </div>
          )}
        </div>

        {/* Analyst consensus bar */}
        {analystConsensus && totalRatings > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Analyst Consensus
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {totalRatings} ratings
              </span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden">
              {analystConsensus.strongBuy > 0 && (
                <div
                  className="bg-emerald-600"
                  style={{
                    width: `${(analystConsensus.strongBuy / totalRatings) * 100}%`,
                  }}
                />
              )}
              {analystConsensus.buy > 0 && (
                <div
                  className="bg-emerald-400"
                  style={{
                    width: `${(analystConsensus.buy / totalRatings) * 100}%`,
                  }}
                />
              )}
              {analystConsensus.hold > 0 && (
                <div
                  className="bg-amber-400"
                  style={{
                    width: `${(analystConsensus.hold / totalRatings) * 100}%`,
                  }}
                />
              )}
              {analystConsensus.sell > 0 && (
                <div
                  className="bg-red-400"
                  style={{
                    width: `${(analystConsensus.sell / totalRatings) * 100}%`,
                  }}
                />
              )}
              {analystConsensus.strongSell > 0 && (
                <div
                  className="bg-red-600"
                  style={{
                    width: `${(analystConsensus.strongSell / totalRatings) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>
                Strong Buy {analystConsensus.strongBuy}
              </span>
              <span>Buy {analystConsensus.buy}</span>
              <span>Hold {analystConsensus.hold}</span>
              <span>Sell {analystConsensus.sell}</span>
            </div>
            {buyPct != null && (
              <p className="text-xs text-muted-foreground">
                <span
                  className={cn(
                    "font-semibold",
                    buyPct >= 60
                      ? "text-emerald-500"
                      : buyPct >= 40
                        ? "text-amber-500"
                        : "text-red-500"
                  )}
                >
                  {buyPct.toFixed(0)}%
                </span>{" "}
                recommend Buy or Strong Buy
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
