"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
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

  const statusDot = analyst.enabled ? "bg-emerald-500" : "bg-muted-foreground/40";

  // Natural language prompt is the primary description; fall back to
  // direction+hold-duration summary if no prompt has been set yet.
  const promptText =
    analyst.analystPrompt ||
    analyst.description ||
    `${analyst.directionBias} · ${analyst.holdDurations.join("/")} · ${analyst.minConfidence}%+ confidence`;

  return (
    // Stretched-link pattern: invisible full-cover anchor at z-0, buttons at z-10
    <div className="relative group">
      <Link
        href={`/analysts/${analyst.id}`}
        className="absolute inset-0 z-0 rounded-[inherit]"
        aria-label={`Open ${analyst.name}`}
      />
      <Card className="group-hover:bg-muted/20 transition-colors h-full">
        <CardContent className="p-5 flex flex-col gap-3">
          {/* Header: status dot + name */}
          <div className="flex items-center gap-2 min-w-0">
            <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot}`} />
            <h2 className="text-sm font-semibold leading-tight truncate">
              {analyst.name}
            </h2>
          </div>

          {/* Analyst prompt — the NL description, 2 lines clamped */}
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {promptText}
          </p>

          {/* Stats */}
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Win Rate
              </p>
              <p className={`text-base font-semibold tabular-nums ${winRateColor}`}>
                {winRatePct}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Trades
              </p>
              <p className="text-base font-semibold tabular-nums text-foreground">
                {analyst.tradeCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                P&L
              </p>
              <p
                className={`text-base font-semibold tabular-nums ${
                  analyst.tradeCount > 0 ? pnlColor : "text-muted-foreground"
                }`}
              >
                {analyst.tradeCount > 0 ? pnlStr : "—"}
              </p>
            </div>
          </div>

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

// ── New Analyst card ──────────────────────────────────────────────────────────

function NewAnalystCard() {
  return (
    <Link href="/analysts/new">
      <Card className="h-full border-dashed hover:bg-muted/20 transition-colors cursor-pointer">
        <CardContent className="p-5 flex flex-col items-center justify-center gap-2 h-full min-h-[160px] text-muted-foreground">
          <div className="h-8 w-8 rounded-full border-2 border-dashed border-current flex items-center justify-center">
            <Plus className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-foreground">New Analyst</p>
          <p className="text-xs text-center">
            Describe what you want to find
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function AnalystsEmptyState() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NewAnalystCard />
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
          <NewAnalystCard />
        </div>
      )}
    </div>
  );
}
