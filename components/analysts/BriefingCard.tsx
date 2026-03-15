"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThesisCard } from "@/components/domain/thesis-card";
import { TradeCard } from "@/components/domain/trade-card";
import { TickerMarkdown } from "@/components/ui/ticker-markdown";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  Briefcase,
  Clock,
  Lightbulb,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import type { AnalystBriefingItem } from "@/lib/actions/analyst.actions";
import type { ThesisCardData } from "@/components/domain/thesis-card";
import type { TradeCardData } from "@/components/domain/trade-card";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return "yesterday";
  return `${diffDays}d ago`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ── Portfolio Snapshot Bar ────────────────────────────────────────────────────

function PortfolioSnapshotBar({
  snapshot,
}: {
  snapshot: {
    openPositions?: number;
    totalInvested?: number;
    closedPnl?: number;
    winRate?: number | null;
    wins?: number;
    losses?: number;
  };
}) {
  const winRate = snapshot.winRate;
  const closedPnl = snapshot.closedPnl ?? 0;

  return (
    <div className="flex items-center gap-4 py-2 border-b border-border">
      {winRate != null && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Win Rate</span>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              winRate >= 0.5 ? "text-emerald-500" : "text-red-500"
            )}
          >
            {Math.round(winRate * 100)}%
          </span>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">P&L</span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            closedPnl >= 0 ? "text-emerald-500" : "text-red-500"
          )}
        >
          {closedPnl >= 0 ? "+" : ""}
          {formatCurrency(closedPnl)}
        </span>
      </div>
      {snapshot.wins != null && snapshot.losses != null && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Record</span>
          <span className="text-sm font-semibold tabular-nums">
            {snapshot.wins}W / {snapshot.losses}L
          </span>
        </div>
      )}
      {snapshot.openPositions != null && snapshot.openPositions > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Open</span>
          <span className="text-sm font-semibold tabular-nums">
            {snapshot.openPositions}
          </span>
        </div>
      )}
    </div>
  );
}

// ── BriefingCard ─────────────────────────────────────────────────────────────

export function BriefingCard({
  briefing,
  expanded = false,
}: {
  briefing: AnalystBriefingItem;
  expanded?: boolean;
}) {
  const theses = Array.isArray(briefing.theses)
    ? (briefing.theses as ThesisCardData[])
    : [];
  const trades = Array.isArray(briefing.trades)
    ? (briefing.trades as TradeCardData[])
    : [];
  const snapshot = (briefing.portfolioSnapshot as Record<string, unknown>) ?? {};

  // Count directions for header
  const longCount = theses.filter((t) => t.direction === "LONG").length;
  const shortCount = theses.filter((t) => t.direction === "SHORT").length;

  return (
    <Card className="overflow-hidden p-0">
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">
            {formatDate(briefing.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {longCount > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              <TrendingUp className="h-2.5 w-2.5" />
              {longCount} long
            </Badge>
          )}
          {shortCount > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              <TrendingDown className="h-2.5 w-2.5" />
              {shortCount} short
            </Badge>
          )}
          {trades.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {trades.length} traded
            </Badge>
          )}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{formatRelativeTime(briefing.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Portfolio snapshot */}
        {Object.keys(snapshot).length > 0 && (
          <PortfolioSnapshotBar
            snapshot={
              snapshot as {
                openPositions?: number;
                totalInvested?: number;
                closedPnl?: number;
                winRate?: number | null;
                wins?: number;
                losses?: number;
              }
            }
          />
        )}

        {/* Narrative — the main briefing text with $TICKER chips */}
        <TickerMarkdown>{briefing.narrative}</TickerMarkdown>

        {/* Strategy notes */}
        {briefing.strategyNotes && (
          <div className="rounded-md border-l-2 border-primary/30 pl-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Strategy Notes
              </span>
            </div>
            <TickerMarkdown>{briefing.strategyNotes}</TickerMarkdown>
          </div>
        )}

        {/* Theses from this run — rendered as compact ThesisCards */}
        {expanded && theses.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Theses
            </span>
            <div className="space-y-3">
              {theses.map((thesis, i) => (
                <ThesisCard key={i} {...thesis} />
              ))}
            </div>
          </div>
        )}

        {/* Trades from this run — rendered as TradeCards */}
        {expanded && trades.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Trades Placed
            </span>
            <div className="space-y-3">
              {trades.map((trade, i) => (
                <TradeCard key={i} {...trade} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
