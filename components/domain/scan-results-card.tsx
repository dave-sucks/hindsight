"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Radar,
  TrendingUp,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScanResultsData = {
  earnings?: {
    ticker: string;
    source: string;
    date?: string;
    epsEstimate?: number | null;
  }[];
  movers?: {
    ticker: string;
    source: string;
    changePct?: number;
    price?: number;
  }[];
  totalFound?: number;
};

export type ScanResultsCardProps = ComponentProps<typeof Card> & ScanResultsData;

// ─── ScanResultsCard ──────────────────────────────────────────────────────────

export function ScanResultsCard({
  earnings = [],
  movers = [],
  totalFound,
  className,
  ...cardProps
}: ScanResultsCardProps) {
  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-semibold">Market Scan</span>
        </div>
        {totalFound != null && (
          <Badge variant="secondary" className="text-[10px] tabular-nums">
            {totalFound} candidates
          </Badge>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Market movers */}
        {movers.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Market Movers
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {movers.map((m, i) => {
                const isUp = (m.changePct ?? 0) >= 0;
                return (
                  <Badge
                    key={i}
                    variant="secondary"
                    className={cn(
                      "text-xs gap-1.5 py-1 px-2.5 font-mono",
                      isUp
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-red-500/10 text-red-500"
                    )}
                  >
                    {isUp ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {m.ticker}
                    {m.changePct != null && (
                      <span className="tabular-nums">
                        {m.changePct >= 0 ? "+" : ""}
                        {m.changePct.toFixed(1)}%
                      </span>
                    )}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming earnings */}
        {earnings.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Upcoming Earnings
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {earnings.slice(0, 10).map((e, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-xs gap-1.5 py-1 px-2.5 font-mono"
                >
                  {e.ticker}
                  {e.date && (
                    <span className="text-muted-foreground text-[10px]">
                      {e.date}
                    </span>
                  )}
                </Badge>
              ))}
              {earnings.length > 10 && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-muted-foreground"
                >
                  +{earnings.length - 10} more
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
