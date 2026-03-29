"use client";

import { Badge } from "@/components/ui/badge";
import { TickerMarkdown } from "@/components/ui/ticker-markdown";
import { formatCurrency } from "@/lib/format";
import { StockLogo } from "@/components/StockLogo";
import { Flag } from "lucide-react";
import type { AnalystBriefingItem } from "@/lib/actions/analyst.actions";

// ── Types for structured brief fields ────────────────────────────────────────

type WatchItem = {
  symbol: string;
  trigger?: string;
  suggestedAction?: string;
  priority?: string;
};

type UnresolvedItem = {
  item: string;
  impact?: string;
  affectedPositions?: string[];
};

type SelfCorrection = {
  observation: string;
  adjustment?: string;
};

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

function safeArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

// ── BriefingCard ─────────────────────────────────────────────────────────────
// Post-run brief. Same p-3 border-b section pattern as morning brief cards.

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

  const watchItems = safeArray<WatchItem>(briefing.watchTomorrow);
  const unresolvedItems = safeArray<UnresolvedItem>(briefing.unresolvedItems);
  const selfCorrections = safeArray<SelfCorrection>(briefing.selfCorrections);

  return (
    <div className="rounded-lg border bg-background">
      {/* Header: date + relative time + stats */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{formatDate(briefing.createdAt)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatRelativeTime(briefing.createdAt)}
          </span>
        </div>
        {Object.keys(snapshot).length > 0 && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
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
                <span className="tabular-nums font-medium">{wins}W / {losses}L</span>
              </span>
            )}
            {openPositions != null && openPositions > 0 && (
              <span>
                Open <span className="tabular-nums font-medium">{openPositions}</span>
              </span>
            )}
            {briefing.marketPosture && (
              <Badge variant="outline">{briefing.marketPosture}</Badge>
            )}
          </div>
        )}
      </div>

      {/* Narrative — the main briefing text */}
      <div className="p-3 border-b">
        <div className="text-sm leading-relaxed">
          <TickerMarkdown>{briefing.narrative}</TickerMarkdown>
        </div>
      </div>

      {/* Strategy notes */}
      {briefing.strategyNotes && (
        <div className="p-3 border-b">
          <div className="text-sm text-muted-foreground italic leading-relaxed">
            <TickerMarkdown>{briefing.strategyNotes}</TickerMarkdown>
          </div>
        </div>
      )}

      {/* Watch Tomorrow */}
      {watchItems.length > 0 && (
        <div className="p-3 border-b space-y-2">
          <p className="text-sm font-medium">Watch Tomorrow</p>
          {watchItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <StockLogo ticker={item.symbol} size="sm" />
              <span className="font-mono text-[11px] font-medium">{item.symbol}</span>
              {item.trigger && (
                <span className="text-xs text-muted-foreground">{item.trigger}</span>
              )}
              {item.suggestedAction && (
                <span className="text-xs text-muted-foreground ml-auto">{item.suggestedAction}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Unresolved Items */}
      {unresolvedItems.length > 0 && (
        <div className="p-3 border-b space-y-2">
          <p className="text-sm font-medium">Unresolved</p>
          {unresolvedItems.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <Flag className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="text-sm text-muted-foreground">
                <span>{item.item}</span>
                {item.impact && (
                  <span className="text-xs ml-1.5 opacity-70">— {item.impact}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Self-Corrections */}
      {selfCorrections.length > 0 && (
        <div className="p-3 space-y-2">
          <p className="text-sm font-medium">Self-Corrections</p>
          {selfCorrections.map((item, i) => (
            <p key={i} className="text-sm text-muted-foreground">
              {item.observation}
              {item.adjustment && (
                <span className="text-xs ml-1.5 opacity-70">→ {item.adjustment}</span>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
