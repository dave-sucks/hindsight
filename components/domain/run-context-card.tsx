"use client";

import type { ComponentProps } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";
import {
  Briefcase,
  Eye,
  FileText,
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
  ShieldAlert,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunContextPosition {
  symbol: string;
  direction: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  targetPrice: number | null;
  stopLoss: number | null;
  daysHeld: number;
}

export interface RunContextWatchItem {
  symbol: string;
  reason: string;
  priority: string;
  thesisDirection: string | null;
  conviction: number | null;
  catalyst: string | null;
}

export interface RunContextThesis {
  ticker: string;
  direction: string;
  confidence: number;
  reasoningSummary: string;
}

export interface RunContextBrief {
  date: string;
  marketPosture: string | null;
  narrative: string;
}

export interface RunContextData {
  portfolio: {
    cash: number;
    portfolioValue: number;
    positions: RunContextPosition[];
    exposure: {
      long: number;
      short: number;
      net: number;
      utilizationPct: number;
    };
  };
  watchlist: RunContextWatchItem[];
  activeTheses: RunContextThesis[];
  priorBrief: RunContextBrief | null;
  performance: {
    winRate: number | null;
    totalTrades: number;
  } | null;
}

export type RunContextCardProps = ComponentProps<typeof Card> & {
  context: RunContextData;
};

// ─── RunContextCard ──────────────────────────────────────────────────────────

export function RunContextCard({
  context,
  className,
  ...cardProps
}: RunContextCardProps) {
  const { portfolio, watchlist, activeTheses, priorBrief, performance } =
    context;
  const hasPositions = portfolio.positions.length > 0;
  const hasWatchlist = watchlist.length > 0;
  const hasTheses = activeTheses.length > 0;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* ── Header ──────────────────────────────────────── */}
      <div className="px-4 py-3 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Run Context</span>
        </div>
        <div className="flex items-center gap-2">
          {performance && performance.totalTrades > 0 && (
            <Badge variant="secondary">
              {performance.winRate != null
                ? `${(performance.winRate * 100).toFixed(0)}% win rate`
                : `${performance.totalTrades} trades`}
            </Badge>
          )}
          {priorBrief?.marketPosture && (
            <Badge variant="outline">{priorBrief.marketPosture}</Badge>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* ── Portfolio summary row ────────────────────── */}
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>
            <span className="uppercase tracking-wide">Cash</span>{" "}
            <span className="tabular-nums font-medium text-foreground">
              ${portfolio.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </span>
          <span>
            <span className="uppercase tracking-wide">Portfolio</span>{" "}
            <span className="tabular-nums font-medium text-foreground">
              ${portfolio.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </span>
          {portfolio.exposure.long > 0 && (
            <span>
              <span className="uppercase tracking-wide">Long</span>{" "}
              <span className="tabular-nums font-medium text-emerald-500">
                ${portfolio.exposure.long.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </span>
          )}
          {portfolio.exposure.short > 0 && (
            <span>
              <span className="uppercase tracking-wide">Short</span>{" "}
              <span className="tabular-nums font-medium text-red-500">
                ${portfolio.exposure.short.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </span>
          )}
          <span>
            <span className="uppercase tracking-wide">Util</span>{" "}
            <span className="tabular-nums font-medium text-foreground">
              {portfolio.exposure.utilizationPct.toFixed(0)}%
            </span>
          </span>
        </div>

        {/* ── Open positions ──────────────────────────── */}
        {hasPositions && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Target className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Open Positions ({portfolio.positions.length})
              </span>
            </div>
            <div className="space-y-0">
              {portfolio.positions.map((pos) => {
                const isLong = pos.direction === "LONG";
                const pnlColor =
                  pos.unrealizedPnl >= 0
                    ? "text-emerald-500"
                    : "text-red-500";
                return (
                  <div
                    key={pos.symbol}
                    className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0"
                  >
                    <StockLogo ticker={pos.symbol} size="sm" />
                    <span className="text-sm font-semibold font-brand w-14">
                      {pos.symbol}
                    </span>
                    <span className="text-[10px] text-muted-foreground w-10">
                      {isLong ? (
                        <TrendingUp className="h-3 w-3 inline text-emerald-500" />
                      ) : (
                        <TrendingDown className="h-3 w-3 inline text-red-500" />
                      )}{" "}
                      {pos.quantity}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground w-16">
                      ${pos.currentPrice.toFixed(2)}
                    </span>
                    <span
                      className={cn(
                        "text-xs tabular-nums font-medium w-20",
                        pnlColor,
                      )}
                    >
                      {pos.unrealizedPnl >= 0 ? "+" : ""}$
                      {pos.unrealizedPnl.toFixed(2)} (
                      {pos.unrealizedPnlPct >= 0 ? "+" : ""}
                      {pos.unrealizedPnlPct.toFixed(1)}%)
                    </span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {pos.daysHeld}d
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Watchlist ────────────────────────────────── */}
        {hasWatchlist && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Eye className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Watchlist ({watchlist.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {watchlist.map((item) => (
                <div
                  key={item.symbol}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1"
                >
                  <StockLogo ticker={item.symbol} size="sm" />
                  <span className="text-xs font-semibold font-brand">
                    {item.symbol}
                  </span>
                  {item.thesisDirection && (
                    <span
                      className={cn(
                        "text-[9px] font-medium uppercase",
                        item.thesisDirection === "LONG"
                          ? "text-emerald-500"
                          : item.thesisDirection === "SHORT"
                            ? "text-red-500"
                            : "text-muted-foreground",
                      )}
                    >
                      {item.thesisDirection}
                    </span>
                  )}
                  {item.priority === "HIGH" && (
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  )}
                  {item.conviction != null && (
                    <span className="text-[9px] tabular-nums text-muted-foreground">
                      {item.conviction}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Active theses ────────────────────────────── */}
        {hasTheses && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Active Theses ({activeTheses.length})
              </span>
            </div>
            <div className="space-y-1">
              {activeTheses.map((thesis) => (
                <div
                  key={thesis.ticker}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="font-semibold font-brand w-12">
                    {thesis.ticker}
                  </span>
                  <span
                    className={cn(
                      "w-10 text-[10px] font-medium uppercase",
                      thesis.direction === "LONG"
                        ? "text-emerald-500"
                        : "text-red-500",
                    )}
                  >
                    {thesis.direction}
                  </span>
                  <span className="tabular-nums text-muted-foreground w-8">
                    {thesis.confidence}%
                  </span>
                  <span className="text-muted-foreground truncate flex-1">
                    {thesis.reasoningSummary}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Prior brief snippet ──────────────────────── */}
        {priorBrief && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <ShieldAlert className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Prior Brief ({priorBrief.date})
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              {priorBrief.narrative}
            </p>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────── */}
        {!hasPositions && !hasWatchlist && !hasTheses && !priorBrief && (
          <p className="text-xs text-muted-foreground text-center py-2">
            First run — no prior context available.
          </p>
        )}
      </div>
    </Card>
  );
}
