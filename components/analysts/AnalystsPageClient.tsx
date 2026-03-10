"use client";

import Link from "next/link";
import { Plus, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RunResearchButton } from "@/components/RunResearchButton";
import { StockLogo } from "@/components/StockLogo";
import { cn } from "@/lib/utils";
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

// ── Gain badge ────────────────────────────────────────────────────────────────

function GainBadge({ totalPnl, tradeCount }: { totalPnl: number; tradeCount: number }) {
  if (tradeCount === 0) return null;
  const pos = totalPnl >= 0;
  const label = pos
    ? `+$${totalPnl.toFixed(0)}`
    : `-$${Math.abs(totalPnl).toFixed(0)}`;
  return (
    <span
      className={cn(
        "text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded shrink-0",
        pos
          ? "bg-emerald-500/15 text-emerald-500"
          : "bg-red-500/15 text-red-500"
      )}
    >
      {label}
    </span>
  );
}

// ── Win-rate bar ──────────────────────────────────────────────────────────────

function WinRateBar({ winRate }: { winRate: number | null }) {
  const filled = winRate != null ? Math.round(winRate * 10) : 0;
  const positive = winRate != null && winRate >= 0.5;

  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 flex-1 rounded-sm",
            i < filled
              ? positive
                ? "bg-emerald-500"
                : "bg-red-500"
              : "bg-muted"
          )}
        />
      ))}
    </div>
  );
}

// ── AnalystCard ───────────────────────────────────────────────────────────────

function AnalystCard({ analyst }: { analyst: AnalystListItem }) {
  const configSubhead = [
    analyst.directionBias,
    analyst.holdDurations.length > 0 ? analyst.holdDurations.join("/") : null,
    `${analyst.minConfidence}%+`,
  ]
    .filter(Boolean)
    .join(" · ");

  const promptText =
    analyst.analystPrompt ||
    analyst.description ||
    null;

  const statusDot = analyst.enabled
    ? "bg-emerald-500"
    : "bg-muted-foreground/40";

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

          {/* Header row: status + name | gain badge + run button */}
          <div className="flex items-center gap-2 min-w-0">
            <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot}`} />
            <h2 className="text-sm font-semibold leading-tight truncate flex-1 min-w-0">
              {analyst.name}
            </h2>
            <div className="flex items-center gap-1.5 shrink-0 relative z-10">
              <GainBadge totalPnl={analyst.totalPnl} tradeCount={analyst.tradeCount} />
              <RunResearchButton
                hasRunning={analyst.lastRunStatus === "RUNNING"}
                analystId={analyst.id}
              />
            </div>
          </div>

          {/* Config subhead — mono small muted */}
          <p className="text-[10px] font-mono text-muted-foreground/70 -mt-1">
            {configSubhead}
          </p>

          {/* Prompt */}
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 min-h-[2rem]">
            {promptText ?? (
              <span className="text-muted-foreground/40 italic">No prompt set</span>
            )}
          </p>

          {/* Win-rate bar */}
          <WinRateBar winRate={analyst.winRate} />

          {/* Active trades — up to 3 */}
          {analyst.openTrades.length > 0 && (
            <div className="space-y-1 relative z-10">
              {analyst.openTrades.map((trade) => {
                const cost = trade.entryPrice * trade.shares;
                return (
                  <Link
                    key={trade.id}
                    href={`/trades/${trade.id}`}
                    className="flex items-center gap-2 py-1 rounded hover:bg-accent/50 transition-colors px-0.5"
                  >
                    <StockLogo ticker={trade.ticker} size="sm" />
                    <span className="text-xs font-mono font-medium">{trade.ticker}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {trade.direction === "LONG" ? "↑" : "↓"}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground ml-auto">
                      ${cost.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                  </Link>
                );
              })}
              <Link
                href={`/analysts/${analyst.id}`}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors block pt-0.5"
              >
                View all trades →
              </Link>
            </div>
          )}

          {/* Footer: last run time */}
          <div className="flex items-center justify-between mt-auto pt-1 border-t">
            <p className="text-xs text-muted-foreground">
              {analyst.lastRunAt
                ? formatRelativeTime(analyst.lastRunAt)
                : "Never run"}
              {analyst.lastRunStatus === "RUNNING" && (
                <span className="ml-1.5 text-amber-500">● Running</span>
              )}
            </p>
            <span className="text-xs tabular-nums text-muted-foreground">
              {analyst.tradeCount} trade{analyst.tradeCount !== 1 ? "s" : ""}
            </span>
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
        <CardContent className="p-5 flex flex-col items-center justify-center gap-2 h-full min-h-[180px] text-muted-foreground">
          <div className="h-8 w-8 rounded-full border-2 border-dashed border-current flex items-center justify-center">
            <Plus className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-foreground">New Analyst</p>
          <p className="text-xs text-center">Describe what you want to find</p>
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
