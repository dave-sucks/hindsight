"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OptionsFlowCardData = {
  ticker?: string;
  putCallRatio?: number | null;
  totalCallVolume?: number;
  totalPutVolume?: number;
  expiration?: string;
  contractsAvailable?: number;
  signal?: string;
};

export type OptionsFlowCardProps = ComponentProps<typeof Card> &
  OptionsFlowCardData;

// ─── OptionsFlowCard — compact inline block ──────────────────────────────────

export function OptionsFlowCard({
  ticker,
  putCallRatio,
  totalCallVolume,
  totalPutVolume,
  signal,
  className,
  ...cardProps
}: OptionsFlowCardProps) {
  const isBullish = signal?.includes("bullish");
  const isBearish = signal?.includes("bearish");
  const totalVol = (totalCallVolume ?? 0) + (totalPutVolume ?? 0);
  const callPct = totalVol > 0 ? ((totalCallVolume ?? 0) / totalVol) * 100 : 50;
  const hasData = putCallRatio != null || totalVol > 0;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Compact header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <span className="text-xs font-medium text-muted-foreground">Options</span>
        {ticker && <span className="text-xs font-mono font-medium">{ticker}</span>}
        <div className="ml-auto flex items-center gap-2">
          {signal && (
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] py-0",
                isBullish && "text-emerald-500",
                isBearish && "text-red-500",
              )}
            >
              {signal}
            </Badge>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!hasData && (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          No options data available — may be a smaller-cap stock or options are not actively traded.
        </div>
      )}

      {/* Compact metrics + ratio bar */}
      {hasData && <div className="px-4 py-2.5 space-y-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">P/C</span>
            <span
              className={cn(
                "tabular-nums font-semibold",
                putCallRatio != null && putCallRatio < 0.7
                  ? "text-emerald-500"
                  : putCallRatio != null && putCallRatio > 1.3
                    ? "text-red-500"
                    : "text-foreground",
              )}
            >
              {putCallRatio != null ? putCallRatio.toFixed(2) : "—"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Calls</span>
            <span className="tabular-nums font-medium text-emerald-500">
              {(totalCallVolume ?? 0).toLocaleString()}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Puts</span>
            <span className="tabular-nums font-medium text-red-500">
              {(totalPutVolume ?? 0).toLocaleString()}
            </span>
          </span>
        </div>

        {/* Ratio bar */}
        {totalVol > 0 && (
          <div className="flex h-1.5 rounded-full overflow-hidden">
            <div className="bg-emerald-500 transition-all" style={{ width: `${callPct}%` }} />
            <div className="bg-red-500 transition-all" style={{ width: `${100 - callPct}%` }} />
          </div>
        )}
      </div>}
    </Card>
  );
}
