"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Calendar } from "lucide-react";

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

// ─── ScanResultsCard — compact ticker chip grid ──────────────────────────────

export function ScanResultsCard({
  earnings = [],
  movers = [],
  totalFound,
  className,
  ...cardProps
}: ScanResultsCardProps) {
  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-border/40">
        <span className="text-xs font-medium text-muted-foreground">Scan</span>
        {totalFound != null && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {totalFound} found
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Market movers — compact colored chips */}
        {movers.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Movers
            </span>
            <div className="flex flex-wrap gap-1">
              {movers.map((m, i) => {
                const isUp = (m.changePct ?? 0) >= 0;
                return (
                  <Badge
                    key={i}
                    variant={isUp ? "positive" : "negative"}
                  >
                    {isUp ? <ArrowUpRight /> : <ArrowDownRight />}
                    {m.ticker}
                    {m.changePct != null && (
                      <span className="tabular-nums">
                        {m.changePct >= 0 ? "+" : ""}{m.changePct.toFixed(1)}%
                      </span>
                    )}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming earnings — outline chips */}
        {earnings.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Calendar className="h-2.5 w-2.5" />
              Earnings
            </span>
            <div className="flex flex-wrap gap-1">
              {earnings.slice(0, 10).map((e, i) => (
                <Badge
                  key={i}
                  variant="outline"
                >
                  {e.ticker}
                  {e.date && (
                    <span className="text-muted-foreground">{e.date}</span>
                  )}
                </Badge>
              ))}
              {earnings.length > 10 && (
                <span className="text-[10px] text-muted-foreground self-center">
                  +{earnings.length - 10} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
