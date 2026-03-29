"use client";

import type { ComponentProps } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClipboardList } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DecisionPick = {
  rank: number;
  ticker: string;
  direction: string;
  confidence: number;
  reasoning: string;
  action: string;
};

export type DecisionSummaryData = {
  rankedPicks: DecisionPick[];
  marketSummary: string;
  exposureBreakdown?: {
    longExposure?: number;
    shortExposure?: number;
    netExposure?: number;
  };
  riskNotes?: string[];
  overallAssessment: string;
  portfolioReview?: string;
};

export type DecisionSummaryCardProps = ComponentProps<typeof Card> &
  DecisionSummaryData;

// ─── Action color helper ─────────────────────────────────────────────────────

function actionColor(action: string): string {
  const a = action.toUpperCase();
  if (a === "INITIATE" || a === "ADD") return "text-positive";
  if (a === "EXIT" || a === "REDUCE") return "text-negative";
  if (a === "HOLD" || a === "WATCH") return "text-muted-foreground";
  return "text-foreground";
}

function confidenceColor(confidence: number): string {
  if (confidence >= 70) return "text-positive";
  if (confidence >= 50) return "text-amber-500";
  return "text-negative";
}

// ─── DecisionSummaryCard ─────────────────────────────────────────────────────

export function DecisionSummaryCard({
  rankedPicks,
  marketSummary,
  exposureBreakdown,
  riskNotes = [],
  overallAssessment,
  portfolioReview,
  className,
  ...cardProps
}: DecisionSummaryCardProps) {
  const actionCount = rankedPicks.filter((p) => {
    const a = p.action.toUpperCase();
    return a !== "HOLD" && a !== "PASS";
  }).length;

  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-4 py-3 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Portfolio Decisions</span>
        </div>
        <Badge variant="secondary">
          {actionCount} action{actionCount !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* ── Decision table ─────────────────────────────────── */}
        {rankedPicks.length > 0 && (
          <div>
            {/* Table header */}
            <div className="flex items-center gap-3 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="w-5 tabular-nums">#</span>
              <span className="w-16">Ticker</span>
              <span className="w-24">Action</span>
              <span className="w-12 text-right">Conf</span>
              <span className="flex-1">Reasoning</span>
            </div>

            {rankedPicks.map((pick) => (
              <div
                key={`${pick.ticker}-${pick.rank}`}
                className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0"
              >
                <span className="w-5 text-xs tabular-nums text-muted-foreground">
                  {pick.rank}
                </span>
                <div className="w-16 flex items-center gap-1.5">
                  <StockLogo ticker={pick.ticker} size="sm" />
                  <span className="text-sm font-semibold font-brand truncate">
                    {pick.ticker}
                  </span>
                </div>
                <span className={cn("w-24 text-xs font-medium", actionColor(pick.action))}>
                  {pick.action.toUpperCase()}
                  {pick.direction && (
                    <span className="text-muted-foreground ml-1">
                      ({pick.direction})
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "w-12 text-right text-xs tabular-nums font-medium",
                    confidenceColor(pick.confidence),
                  )}
                >
                  {pick.confidence}%
                </span>
                <span className="flex-1 text-xs text-muted-foreground truncate">
                  {pick.reasoning}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Exposure row ───────────────────────────────────── */}
        {exposureBreakdown && (
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            {exposureBreakdown.longExposure != null && (
              <span>
                <span className="uppercase tracking-wide">Long</span>{" "}
                <span className="tabular-nums font-medium text-positive">
                  ${exposureBreakdown.longExposure.toLocaleString()}
                </span>
              </span>
            )}
            {exposureBreakdown.shortExposure != null && (
              <span>
                <span className="uppercase tracking-wide">Short</span>{" "}
                <span className="tabular-nums font-medium text-negative">
                  ${exposureBreakdown.shortExposure.toLocaleString()}
                </span>
              </span>
            )}
            {exposureBreakdown.netExposure != null && (
              <span>
                <span className="uppercase tracking-wide">Net</span>{" "}
                <span
                  className={cn(
                    "tabular-nums font-medium",
                    exposureBreakdown.netExposure >= 0
                      ? "text-positive"
                      : "text-negative",
                  )}
                >
                  ${Math.abs(exposureBreakdown.netExposure).toLocaleString()}
                  {exposureBreakdown.netExposure >= 0 ? " long" : " short"}
                </span>
              </span>
            )}
          </div>
        )}

        {/* ── Portfolio review ────────────────────────────────── */}
        {portfolioReview && (
          <div className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Portfolio Review
            </span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {portfolioReview}
            </p>
          </div>
        )}

        {/* ── Risk notes ──────────────────────────────────────── */}
        {riskNotes.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Risk Notes
            </span>
            <ul className="space-y-0.5">
              {riskNotes.map((note, i) => (
                <li
                  key={i}
                  className="text-sm text-muted-foreground leading-relaxed"
                >
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Overall assessment ──────────────────────────────── */}
        {overallAssessment && (
          <div className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Assessment
            </span>
            <p className="text-sm text-foreground/80 leading-relaxed">
              {overallAssessment}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
