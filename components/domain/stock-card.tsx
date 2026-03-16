"use client";

import { useState } from "react";
import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PnlBadge } from "@/components/ui/pnl-badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Building2 } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";

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

function fmtCap(val: number): string {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function fmtVol(val: number): string {
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(0)}K`;
  return val.toLocaleString();
}

// ─── Metric row helper ───────────────────────────────────────────────────────

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs tabular-nums font-medium">{value}</span>
    </div>
  );
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
  const [open, setOpen] = useState(false);
  const isUp = (changePct ?? 0) >= 0;

  const totalRatings = analystConsensus
    ? analystConsensus.strongBuy + analystConsensus.buy + analystConsensus.hold + analystConsensus.sell + analystConsensus.strongSell
    : 0;
  const buyPct =
    totalRatings > 0 && analystConsensus
      ? ((analystConsensus.strongBuy + analystConsensus.buy) / totalRatings) * 100
      : null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Card
            className={cn(
              "overflow-hidden p-0 cursor-pointer transition-colors hover:border-foreground/25",
              className,
            )}
            {...cardProps}
          />
        }
      >
          {/* ── Header: Logo + name + price ────────────────────────── */}
          <div className="p-3">
            <div className="flex items-start justify-between gap-4">
              {/* Left: logo + company name + ticker subhead */}
              <div className="flex items-center gap-2.5 min-w-0">
                <StockLogo ticker={ticker} size="lg" />
                <div className="min-w-0">
                  <p className="text-lg font-brand font-bold text-foreground truncate leading-tight">
                    {companyName ?? ticker}
                  </p>
                  <div className="font-mono text-[11px] text-muted-foreground leading-tight mt-0.5 flex items-center gap-1 flex-wrap">
                    <span>{ticker}</span>
                    {exchange && (
                      <>
                        <span className="opacity-30">&middot;</span>
                        <span>{exchange}</span>
                      </>
                    )}
                    {sector && (
                      <>
                        <span className="opacity-30">&middot;</span>
                        <span>{sector}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: price + change + PnlBadge */}
              <div className="shrink-0 text-right">
                <div className="flex items-center gap-2">
                  {price != null && (
                    <p className="text-lg font-medium tabular-nums text-foreground leading-none">
                      ${price.toFixed(2)}
                    </p>
                  )}
                  {change != null && (
                    <span
                      className={cn(
                        "text-lg tabular-nums font-light",
                        isUp ? "text-positive" : "text-negative",
                      )}
                    >
                      {change >= 0 ? "+" : "\u2212"}${Math.abs(change).toFixed(2)}
                    </span>
                  )}
                  {changePct != null && <PnlBadge value={changePct} />}
                </div>
                {/* Compact fundamentals under price */}
                {(marketCap != null || peRatio != null) && (
                  <div className="flex items-center gap-2 mt-1 justify-end text-[10px] text-muted-foreground">
                    {marketCap != null && (
                      <span className="tabular-nums">{fmtCap(marketCap)}</span>
                    )}
                    {peRatio != null && (
                      <span className="tabular-nums">P/E {peRatio.toFixed(1)}x</span>
                    )}
                    {buyPct != null && (
                      <span
                        className={cn(
                          "tabular-nums font-medium",
                          buyPct >= 60 ? "text-positive" : buyPct >= 40 ? "text-amber-500" : "text-negative",
                        )}
                      >
                        {buyPct.toFixed(0)}% Buy
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center gap-3">
            <StockLogo ticker={ticker} size="lg" />
            <div>
              <SheetTitle className="text-lg font-bold">
                {companyName ?? ticker}
              </SheetTitle>
              <span className="text-xs font-mono text-muted-foreground">
                {ticker}{exchange ? ` · ${exchange}` : ""}
              </span>
            </div>
          </div>
          {price != null && (
            <div className="flex items-end gap-2 mt-2">
              <span className="text-2xl tabular-nums font-bold">
                ${price.toFixed(2)}
              </span>
              {changePct != null && (
                <span
                  className={cn(
                    "flex items-center gap-1 text-sm font-semibold tabular-nums pb-0.5",
                    isUp ? "text-positive" : "text-negative",
                  )}
                >
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
        </SheetHeader>

        <div className="p-4 space-y-5">
          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {sector && (
              <Badge variant="outline">
                <Building2 />
                {sector}
              </Badge>
            )}
            {exchange && (
              <Badge variant="outline">
                {exchange}
              </Badge>
            )}
          </div>

          {/* Key metrics */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fundamentals
            </span>
            <div className="mt-2">
              {marketCap != null && <MetricRow label="Market Cap" value={fmtCap(marketCap)} />}
              {peRatio != null && <MetricRow label="P/E Ratio" value={`${peRatio.toFixed(1)}x`} />}
              {beta != null && <MetricRow label="Beta" value={beta.toFixed(2)} />}
              {avgVolume != null && <MetricRow label="Avg Volume (10d)" value={fmtVol(avgVolume)} />}
            </div>
          </div>

          {/* Price range */}
          {(dayHigh != null || high52w != null) && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Price Range
              </span>
              <div className="mt-2">
                {dayHigh != null && dayLow != null && (
                  <MetricRow label="Day Range" value={`$${dayLow.toFixed(2)} – $${dayHigh.toFixed(2)}`} />
                )}
                {high52w != null && low52w != null && (
                  <MetricRow label="52W Range" value={`$${low52w.toFixed(2)} – $${high52w.toFixed(2)}`} />
                )}
              </div>
            </div>
          )}

          {/* Analyst consensus */}
          {analystConsensus && totalRatings > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Analyst Consensus
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {totalRatings} ratings
                </span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden mb-2">
                {analystConsensus.strongBuy > 0 && (
                  <div className="bg-positive" style={{ width: `${(analystConsensus.strongBuy / totalRatings) * 100}%` }} />
                )}
                {analystConsensus.buy > 0 && (
                  <div className="bg-positive" style={{ width: `${(analystConsensus.buy / totalRatings) * 100}%` }} />
                )}
                {analystConsensus.hold > 0 && (
                  <div className="bg-amber-400" style={{ width: `${(analystConsensus.hold / totalRatings) * 100}%` }} />
                )}
                {analystConsensus.sell > 0 && (
                  <div className="bg-negative" style={{ width: `${(analystConsensus.sell / totalRatings) * 100}%` }} />
                )}
                {analystConsensus.strongSell > 0 && (
                  <div className="bg-negative" style={{ width: `${(analystConsensus.strongSell / totalRatings) * 100}%` }} />
                )}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>Strong Buy {analystConsensus.strongBuy}</span>
                <span>Buy {analystConsensus.buy}</span>
                <span>Hold {analystConsensus.hold}</span>
                <span>Sell {analystConsensus.sell}</span>
              </div>
              {buyPct != null && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  <span
                    className={cn(
                      "font-semibold",
                      buyPct >= 60 ? "text-positive" : buyPct >= 40 ? "text-amber-500" : "text-negative",
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
      </SheetContent>
    </Sheet>
  );
}
