"use client";

import type { ComponentProps } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Target } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnalystTargetsData = {
  ticker?: string;
  consensusTarget?: number | null;
  high?: number | null;
  low?: number | null;
  median?: number | null;
  numAnalysts?: number | null;
  currentPrice?: number | null;
};

export type AnalystTargetsCardProps = ComponentProps<typeof Card> & AnalystTargetsData;

// ─── AnalystTargetsCard ───────────────────────────────────────────────────────

export function AnalystTargetsCard({
  ticker,
  consensusTarget,
  high,
  low,
  median,
  numAnalysts,
  currentPrice,
  className,
  ...cardProps
}: AnalystTargetsCardProps) {
  const hasData = consensusTarget != null || high != null || low != null;
  const upside =
    consensusTarget != null && currentPrice != null && currentPrice > 0
      ? ((consensusTarget - currentPrice) / currentPrice) * 100
      : null;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <Target className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Analyst Targets</span>
        {ticker && <span className="text-xs font-mono font-medium">{ticker}</span>}
        {numAnalysts != null && (
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
            {numAnalysts} analyst{numAnalysts !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          No analyst price targets available.
        </div>
      ) : (
        <div className="px-4 py-2.5 space-y-2">
          <div className="flex items-center gap-4 text-xs">
            {consensusTarget != null && (
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Consensus</span>
                <span className="tabular-nums font-semibold">${consensusTarget.toFixed(2)}</span>
                {upside != null && (
                  <span className={cn("text-[10px] tabular-nums font-medium", upside >= 0 ? "text-positive" : "text-negative")}>
                    {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                  </span>
                )}
              </span>
            )}
            {median != null && (
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Median</span>
                <span className="tabular-nums font-medium">${median.toFixed(2)}</span>
              </span>
            )}
          </div>

          {/* Range bar */}
          {low != null && high != null && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">${low.toFixed(0)}</span>
              <div className="relative flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                {consensusTarget != null && low < high && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary/60"
                    style={{ width: `${Math.min(((consensusTarget - low) / (high - low)) * 100, 100)}%` }}
                  />
                )}
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">${high.toFixed(0)}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
