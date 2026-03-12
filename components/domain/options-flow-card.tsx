"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";

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

// ─── OptionsFlowCard ──────────────────────────────────────────────────────────

export function OptionsFlowCard({
  ticker,
  putCallRatio,
  totalCallVolume,
  totalPutVolume,
  expiration,
  contractsAvailable,
  signal,
  className,
  ...cardProps
}: OptionsFlowCardProps) {
  const isBullish = signal?.includes("bullish");
  const isBearish = signal?.includes("bearish");

  const totalVol = (totalCallVolume ?? 0) + (totalPutVolume ?? 0);
  const callPct = totalVol > 0 ? ((totalCallVolume ?? 0) / totalVol) * 100 : 50;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-semibold">
            Options Flow
            {ticker && (
              <span className="ml-1.5 font-mono text-muted-foreground">
                {ticker}
              </span>
            )}
          </span>
        </div>
        {signal && (
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px]",
              isBullish && "text-emerald-500",
              isBearish && "text-red-500"
            )}
          >
            {signal}
          </Badge>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Volume stats */}
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-muted/40 p-4 text-center">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Call Volume
            </p>
            <p className="text-base tabular-nums font-bold text-emerald-500">
              {(totalCallVolume ?? 0).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Put Volume
            </p>
            <p className="text-base tabular-nums font-bold text-red-500">
              {(totalPutVolume ?? 0).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              P/C Ratio
            </p>
            <p
              className={cn(
                "text-base tabular-nums font-bold",
                putCallRatio != null && putCallRatio < 0.7
                  ? "text-emerald-500"
                  : putCallRatio != null && putCallRatio > 1.3
                    ? "text-red-500"
                    : "text-foreground"
              )}
            >
              {putCallRatio != null ? putCallRatio.toFixed(2) : "—"}
            </p>
          </div>
        </div>

        {/* Call/Put ratio bar */}
        {totalVol > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>Calls {callPct.toFixed(0)}%</span>
              <span>Puts {(100 - callPct).toFixed(0)}%</span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${callPct}%` }}
              />
              <div
                className="bg-red-500 transition-all"
                style={{ width: `${100 - callPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {expiration && <span>Expiry: {expiration}</span>}
          {contractsAvailable != null && (
            <span>{contractsAvailable} contracts</span>
          )}
        </div>
      </div>
    </Card>
  );
}
