"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Layers,
  Target,
  ShieldAlert,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PickRanking = {
  rank: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  confidence: number;
  reasoning: string;
  action: "TRADE" | "WATCH" | "PASS";
};

export type RunSummaryData = {
  marketSummary: string;
  rankedPicks: PickRanking[];
  exposureBreakdown?: {
    longExposure: number;
    shortExposure: number;
    netExposure: number;
    sectorConcentration?: string;
  };
  riskNotes?: string[];
  overallAssessment?: string;
};

export type RunSummaryCardProps = ComponentProps<typeof Card> & RunSummaryData;

// ─── RunSummaryCard ───────────────────────────────────────────────────────────

export function RunSummaryCard({
  marketSummary,
  rankedPicks,
  exposureBreakdown,
  riskNotes = [],
  overallAssessment,
  className,
  ...cardProps
}: RunSummaryCardProps) {
  const trades = rankedPicks.filter((p) => p.action === "TRADE");
  const watches = rankedPicks.filter((p) => p.action === "WATCH");

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Portfolio Synthesis</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            <Target className="h-2.5 w-2.5" />
            {trades.length} trades
          </Badge>
          {watches.length > 0 && (
            <Badge variant="secondary">
              {watches.length} watchlist
            </Badge>
          )}
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Market summary */}
        <p className="text-sm text-foreground/80 leading-relaxed">
          {marketSummary}
        </p>

        {/* Ranked picks */}
        {rankedPicks.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Ranked Picks
            </span>
            <div className="space-y-1.5">
              {rankedPicks.map((pick) => {
                const isLong = pick.direction === "LONG";
                return (
                  <div
                    key={pick.ticker}
                    className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-muted-foreground tabular-nums w-5">
                      #{pick.rank}
                    </span>
                    <span className="font-mono font-semibold text-sm">
                      {pick.ticker}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-0.5 text-xs font-medium",
                        isLong ? "text-positive" : "text-negative"
                      )}
                    >
                      {isLong ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {pick.direction}
                    </span>
                    <span
                      className={cn(
                        "text-xs tabular-nums font-medium",
                        pick.confidence >= 70
                          ? "text-positive"
                          : "text-amber-500"
                      )}
                    >
                      {pick.confidence}%
                    </span>
                    <Badge
                      variant={
                        pick.action === "TRADE"
                          ? "positive"
                          : pick.action === "WATCH"
                            ? "warning"
                            : "secondary"
                      }
                    >
                      {pick.action}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Exposure breakdown */}
        {exposureBreakdown && (
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/40 p-3 text-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Long
              </p>
              <p className="text-sm tabular-nums font-semibold text-positive">
                ${exposureBreakdown.longExposure.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Short
              </p>
              <p className="text-sm tabular-nums font-semibold text-negative">
                ${exposureBreakdown.shortExposure.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Net
              </p>
              <p
                className={cn(
                  "text-sm tabular-nums font-semibold",
                  exposureBreakdown.netExposure >= 0
                    ? "text-positive"
                    : "text-negative"
                )}
              >
                ${Math.abs(exposureBreakdown.netExposure).toLocaleString()}
                {exposureBreakdown.netExposure >= 0 ? " long" : " short"}
              </p>
            </div>
          </div>
        )}

        {/* Risk notes */}
        {riskNotes.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Risk Notes
              </span>
            </div>
            <ul className="space-y-1">
              {riskNotes.map((note, i) => (
                <li
                  key={i}
                  className="text-sm text-muted-foreground leading-relaxed pl-5"
                >
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Overall assessment */}
        {overallAssessment && (
          <div className="rounded-md border-l-2 border-primary/30 pl-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Assessment
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed">
              {overallAssessment}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
