"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { RunResearchButton } from "@/components/RunResearchButton";
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

  const visibleSignals = analyst.signalTypes.slice(0, 4);
  const statusDot = analyst.enabled ? "bg-emerald-500" : "bg-muted-foreground/40";

  return (
    // Stretched-link pattern: invisible full-cover anchor at z-0, buttons at z-10
    <div className="relative group">
      <Link
        href={`/analysts/${analyst.id}`}
        className="absolute inset-0 z-0 rounded-[inherit]"
        aria-label={`Open ${analyst.name}`}
      />
      <Card className="group-hover:bg-muted/20 transition-colors h-full">
        <CardContent className="p-5 flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot}`} />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold leading-tight truncate">
                  {analyst.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {analyst.directionBias} · {analyst.holdDurations.join("/")}
                </p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Win Rate
              </p>
              <p className={`text-lg font-semibold tabular-nums ${winRateColor}`}>
                {winRatePct}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Trades
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {analyst.tradeCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                P&amp;L
              </p>
              <p
                className={`text-lg font-semibold tabular-nums ${
                  analyst.tradeCount > 0 ? pnlColor : "text-muted-foreground"
                }`}
              >
                {analyst.tradeCount > 0 ? pnlStr : "—"}
              </p>
            </div>
          </div>

          {/* Signal chips */}
          {visibleSignals.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {visibleSignals.map((s) => (
                <span
                  key={s}
                  className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
                >
                  {s.replace(/_/g, " ")}
                </span>
              ))}
              {analyst.signalTypes.length > 4 && (
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                  +{analyst.signalTypes.length - 4}
                </span>
              )}
            </div>
          )}

          {/* Footer: last run + run button */}
          <div className="flex items-center justify-between mt-auto relative z-10">
            <p className="text-xs text-muted-foreground">
              {analyst.lastRunAt
                ? formatRelativeTime(analyst.lastRunAt)
                : "Never run"}
              {analyst.lastRunStatus === "RUNNING" && (
                <span className="ml-1.5 text-amber-500">● Running</span>
              )}
            </p>
            <RunResearchButton
              hasRunning={analyst.lastRunStatus === "RUNNING"}
              analystId={analyst.id}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function AnalystsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-3 text-muted-foreground">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <span className="text-xl">🤖</span>
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No analysts yet</p>
        <p className="text-sm mt-1">
          Create your first AI analyst to start automated research
        </p>
      </div>
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
      <h1 className="text-2xl font-semibold">Analysts</h1>

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
