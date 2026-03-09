"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RunResearchButton } from "@/components/RunResearchButton";
import { Bot, Settings } from "lucide-react";
import type { AnalystListItem } from "@/lib/actions/analyst.actions";

// ── Relative time helper ──────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

// ── AnalystCard ───────────────────────────────────────────────────────────────

function AnalystCard({ analyst }: { analyst: AnalystListItem }) {
  const winRatePct =
    analyst.winRate != null ? `${Math.round(analyst.winRate * 100)}%` : "—";
  const winRateColor =
    analyst.winRate != null
      ? analyst.winRate >= 0.5
        ? "text-emerald-500"
        : "text-red-500"
      : "text-muted-foreground";
  const pnlColor = analyst.totalPnl >= 0 ? "text-emerald-500" : "text-red-500";
  const pnlStr =
    analyst.totalPnl >= 0
      ? `+$${analyst.totalPnl.toFixed(2)}`
      : `-$${Math.abs(analyst.totalPnl).toFixed(2)}`;

  const visibleSignals = analyst.signalTypes.slice(0, 3);

  return (
    <Card className="flex flex-col">
      <CardContent className="p-6 flex flex-col flex-1 gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-tight">{analyst.name}</h2>
              <p className="text-xs text-muted-foreground">
                {analyst.directionBias} · {analyst.holdDurations.join("/")}
              </p>
            </div>
          </div>
          <Badge
            variant={analyst.enabled ? "default" : "secondary"}
            className="text-xs shrink-0"
          >
            {analyst.enabled ? "Active" : "Paused"}
          </Badge>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
              Win Rate
            </p>
            <p className={`text-sm font-semibold tabular-nums ${winRateColor}`}>
              {winRatePct}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
              Trades
            </p>
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {analyst.tradeCount}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
              P&L
            </p>
            <p className={`text-sm font-semibold tabular-nums ${pnlColor}`}>
              {analyst.tradeCount > 0 ? pnlStr : "—"}
            </p>
          </div>
        </div>

        {/* Signal badges */}
        {visibleSignals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visibleSignals.map((s) => (
              <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">
                {s.replace(/_/g, " ")}
              </Badge>
            ))}
            {analyst.signalTypes.length > 3 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                +{analyst.signalTypes.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Last run */}
        <p className="text-xs text-muted-foreground mt-auto">
          {analyst.lastRunAt
            ? `Last run: ${formatRelativeTime(analyst.lastRunAt)}`
            : "Never run"}
          {analyst.lastRunStatus === "RUNNING" && (
            <span className="ml-1.5 text-amber-500">● Running</span>
          )}
        </p>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            render={<Link href={`/analysts/${analyst.id}`} />}
            size="sm"
            className="flex-1"
          >
            Open →
          </Button>
          <RunResearchButton
            hasRunning={analyst.lastRunStatus === "RUNNING"}
            analystId={analyst.id}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function AnalystsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <Bot className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">No analysts yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create your first AI analyst in Settings
        </p>
      </div>
      <Button
        render={<Link href="/settings?tab=analysts" />}
        variant="outline"
        size="sm"
      >
        <Settings className="h-3.5 w-3.5 mr-1.5" />
        Go to Settings
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystsPageClient({
  analysts,
}: {
  analysts: AnalystListItem[];
}) {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analysts</h1>
        <Button
          render={<Link href="/settings?tab=analysts" />}
          size="sm"
          variant="outline"
        >
          <Settings className="h-3.5 w-3.5 mr-1.5" />
          Manage
        </Button>
      </div>

      {/* Content */}
      {analysts.length === 0 ? (
        <AnalystsEmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {analysts.map((analyst) => (
            <AnalystCard key={analyst.id} analyst={analyst} />
          ))}
        </div>
      )}
    </div>
  );
}
