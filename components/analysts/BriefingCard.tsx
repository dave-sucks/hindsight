"use client";

import { TickerMarkdown } from "@/components/ui/ticker-markdown";
import { formatCurrency } from "@/lib/format";
import { Calendar, Clock } from "lucide-react";
import type { AnalystBriefingItem } from "@/lib/actions/analyst.actions";

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

// ── BriefingCard ─────────────────────────────────────────────────────────────

export function BriefingCard({
  briefing,
}: {
  briefing: AnalystBriefingItem;
  expanded?: boolean;
}) {
  const snapshot = (briefing.portfolioSnapshot as Record<string, unknown>) ?? {};
  const closedPnl = (snapshot.closedPnl as number) ?? 0;
  const wins = snapshot.wins as number | undefined;
  const losses = snapshot.losses as number | undefined;
  const openPositions = snapshot.openPositions as number | undefined;

  return (
    <div className="py-6 border-b border-border last:border-0">
      {/* Date header + relative time */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          <span className="font-medium">{formatDate(briefing.createdAt)}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{formatRelativeTime(briefing.createdAt)}</span>
        </div>
      </div>

      {/* Stats line */}
      {Object.keys(snapshot).length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
          <span>
            P&L{" "}
            <span className="tabular-nums font-medium">
              {closedPnl >= 0 ? "+" : ""}
              {formatCurrency(closedPnl)}
            </span>
          </span>
          {wins != null && losses != null && (
            <span>
              Record{" "}
              <span className="tabular-nums font-medium">
                {wins}W / {losses}L
              </span>
            </span>
          )}
          {openPositions != null && openPositions > 0 && (
            <span>
              Open{" "}
              <span className="tabular-nums font-medium">{openPositions}</span>
            </span>
          )}
        </div>
      )}

      {/* Narrative — the main briefing text */}
      <TickerMarkdown>{briefing.narrative}</TickerMarkdown>

      {/* Strategy notes — just italic text, no box */}
      {briefing.strategyNotes && (
        <div className="mt-4 text-sm text-muted-foreground italic">
          <TickerMarkdown>{briefing.strategyNotes}</TickerMarkdown>
        </div>
      )}
    </div>
  );
}
