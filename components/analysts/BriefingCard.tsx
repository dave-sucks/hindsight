"use client";

import { Badge } from "@/components/ui/badge";
import { TickerMarkdown } from "@/components/ui/ticker-markdown";
import { formatCurrency } from "@/lib/format";
import { StockLogo } from "@/components/StockLogo";
import {
  AlertCircle,
  Calendar,
  Clock,
  Eye,
  RefreshCw,
  Shield,
} from "lucide-react";
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

      {/* Stats line + market posture */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
        {Object.keys(snapshot).length > 0 && (
          <>
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
          </>
        )}
        {briefing.marketPosture && (
          <Badge variant="outline">
            <Shield className="h-3 w-3" />
            {briefing.marketPosture}
          </Badge>
        )}
      </div>

      {/* Narrative — the main briefing text */}
      <TickerMarkdown>{briefing.narrative}</TickerMarkdown>

      {/* Strategy notes — just italic text, no box */}
      {briefing.strategyNotes && (
        <div className="mt-4 text-sm text-muted-foreground italic">
          <TickerMarkdown>{briefing.strategyNotes}</TickerMarkdown>
        </div>
      )}

      {/* Watch Tomorrow */}
      {watchItems.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            Watch Tomorrow
          </div>
          <div className="flex flex-wrap gap-2">
            {watchItems.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <StockLogo ticker={item.symbol} size="xs" />
                <span className="font-medium">{item.symbol}</span>
                {item.trigger && (
                  <span className="text-muted-foreground text-xs">
                    {item.trigger}
                  </span>
                )}
                {item.suggestedAction && (
                  <Badge variant="outline">{item.suggestedAction}</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unresolved Items */}
      {unresolvedItems.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-500">
            <AlertCircle className="h-3.5 w-3.5" />
            Unresolved
          </div>
          <div className="space-y-1.5">
            {unresolvedItems.map((item, i) => (
              <div key={i} className="text-sm text-muted-foreground">
                <span>{item.item}</span>
                {item.impact && (
                  <span className="text-xs ml-1.5 opacity-70">— {item.impact}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Self-Corrections */}
      {selfCorrections.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            Self-Corrections
          </div>
          <div className="space-y-1.5">
            {selfCorrections.map((item, i) => (
              <div key={i} className="text-sm text-muted-foreground">
                <span>{item.observation}</span>
                {item.adjustment && (
                  <span className="text-xs ml-1.5 opacity-70">→ {item.adjustment}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
