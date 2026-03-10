"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RunResearchButton } from "@/components/RunResearchButton";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ArrowLeft,
} from "lucide-react";
import type {
  AnalystDetail,
  RunWithTheses,
  TradeWithThesis,
} from "@/lib/actions/analyst.actions";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  className = "text-foreground",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
          {label}
        </p>
        <p className={`text-lg font-semibold tabular-nums ${className}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Direction badge ───────────────────────────────────────────────────────────

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === "LONG")
    return (
      <Badge
        variant="outline"
        className="text-emerald-500 border-emerald-500/30 text-[10px] py-0 px-1.5"
      >
        <TrendingUp className="h-2.5 w-2.5 mr-0.5" />
        LONG
      </Badge>
    );
  if (direction === "SHORT")
    return (
      <Badge
        variant="outline"
        className="text-red-500 border-red-500/30 text-[10px] py-0 px-1.5"
      >
        <TrendingDown className="h-2.5 w-2.5 mr-0.5" />
        SHORT
      </Badge>
    );
  return (
    <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
      <Minus className="h-2.5 w-2.5 mr-0.5" />
      PASS
    </Badge>
  );
}

// ── Inline collapsible config ─────────────────────────────────────────────────

function InlineConfig({ config }: { config: AnalystDetail["config"] }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-2 text-sm font-medium hover:text-foreground text-muted-foreground transition-colors group">
        <span className="text-xs font-medium uppercase tracking-wide">
          Strategy Config
        </span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-2 pb-4 space-y-4">
          {/* Params grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
            {[
              { label: "Direction", value: config.directionBias },
              {
                label: "Hold Durations",
                value: config.holdDurations.join(", ") || "—",
              },
              { label: "Min Confidence", value: `${config.minConfidence}%` },
              { label: "Max Positions", value: String(config.maxOpenPositions) },
              {
                label: "Max Position Size",
                value: formatCurrency(config.maxPositionSize),
              },
              {
                label: "Max Risk %",
                value: config.maxRiskPct != null ? `${config.maxRiskPct}%` : "—",
              },
              { label: "Schedule", value: config.scheduleTime },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  {label}
                </p>
                <p className="text-sm tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          {config.sectors.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Sectors
              </p>
              <div className="flex flex-wrap gap-1.5">
                {config.sectors.map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {config.signalTypes.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Signal Types
              </p>
              <div className="flex flex-wrap gap-1.5">
                {config.signalTypes.map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">
                    {s.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Run history ───────────────────────────────────────────────────────────────

function RunHistory({ runs }: { runs: RunWithTheses[] }) {
  if (runs.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <p className="text-sm font-medium text-foreground">No runs yet</p>
        <p className="text-sm mt-1">
          Click &ldquo;Run Research Now&rdquo; to start your first run
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg divide-y overflow-hidden">
      {runs.map((run) => {
        const actionableCount = run.theses.filter(
          (t) => t.direction !== "PASS"
        ).length;
        const tradeCount = run.theses.filter((t) => t.trade).length;
        const statusDot =
          run.status === "COMPLETE"
            ? "bg-emerald-500"
            : run.status === "RUNNING"
            ? "bg-amber-500 animate-pulse"
            : "bg-red-400";

        return (
          <Link
            key={run.id}
            href={`/runs/${run.id}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {formatRelativeTime(run.startedAt)}
                  {run.status === "RUNNING" && (
                    <span className="ml-2 text-xs text-amber-500 font-normal">
                      Running
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {run.theses.length} analyzed
                  {actionableCount > 0 && ` · ${actionableCount} recommended`}
                  {tradeCount > 0 && ` · ${tradeCount} trades`}
                </p>
              </div>
            </div>
            <Badge
              variant={run.source === "AGENT" ? "default" : "secondary"}
              className="text-[10px] shrink-0 ml-3"
            >
              {run.source}
            </Badge>
          </Link>
        );
      })}
    </div>
  );
}

// ── Trades list ───────────────────────────────────────────────────────────────

function TradesList({ trades }: { trades: TradeWithThesis[] }) {
  if (trades.length === 0) return null;

  return (
    <div className="space-y-1">
      {trades.slice(0, 8).map((trade) => {
        const pnl = trade.realizedPnl ?? 0;
        const pnlColor =
          trade.status === "OPEN"
            ? "text-muted-foreground"
            : pnl >= 0
            ? "text-emerald-500"
            : "text-red-500";
        const pnlStr =
          trade.status === "OPEN"
            ? "Open"
            : pnl >= 0
            ? `+${formatCurrency(pnl)}`
            : formatCurrency(pnl);

        return (
          <Link
            key={trade.id}
            href={`/trades/${trade.id}`}
            className="flex items-center justify-between py-3 px-3 -mx-1 rounded-lg hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <span className="text-[9px] font-bold text-muted-foreground">
                  {trade.ticker.slice(0, 2)}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{trade.ticker}</span>
                  <DirectionBadge direction={trade.direction} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {trade.status === "OPEN"
                    ? `Opened ${formatRelativeTime(trade.openedAt)}`
                    : `Closed ${
                        trade.closedAt
                          ? formatRelativeTime(trade.closedAt)
                          : ""
                      }`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-sm font-medium tabular-nums ${pnlColor}`}>
                {pnlStr}
              </p>
              {trade.outcome && (
                <Badge
                  variant={
                    trade.outcome === "WIN"
                      ? "default"
                      : trade.outcome === "LOSS"
                      ? "destructive"
                      : "secondary"
                  }
                  className="text-[10px]"
                >
                  {trade.outcome}
                </Badge>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystDetailClient({
  detail,
  hasRunning,
}: {
  detail: AnalystDetail;
  userId: string;
  recentTheses: { id: string; ticker: string; direction: string; confidenceScore: number; reasoningSummary: string; createdAt: Date }[];
  hasRunning: boolean;
}) {
  const { config, stats, recentRuns, recentTrades } = detail;

  const winRatePct =
    stats.winRate != null ? `${Math.round(stats.winRate * 100)}%` : "—";
  const winRateColor =
    stats.winRate != null
      ? stats.winRate >= 0.5
        ? "text-emerald-500"
        : "text-red-500"
      : "text-muted-foreground";
  const pnlColor =
    stats.totalTrades > 0
      ? stats.totalPnl >= 0
        ? "text-emerald-500"
        : "text-red-500"
      : "text-muted-foreground";
  const pnlStr =
    stats.totalTrades > 0
      ? (stats.totalPnl >= 0 ? "+" : "") + formatCurrency(stats.totalPnl)
      : "—";

  return (
    <div className="overflow-y-auto h-[calc(100dvh-5.25rem)]">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {/* Back link + header */}
        <div className="space-y-2">
          <Link
            href="/analysts"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Analysts
          </Link>

          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`h-2.5 w-2.5 rounded-full shrink-0 mt-0.5 ${
                  config.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                }`}
              />
              <h1 className="text-2xl font-semibold leading-tight">
                {config.name}
              </h1>
            </div>
            <RunResearchButton analystId={config.id} hasRunning={hasRunning} />
          </div>

          {(config.analystPrompt || config.description) && (
            <p className="text-sm text-muted-foreground leading-relaxed pl-[1.25rem]">
              {config.analystPrompt || config.description}
            </p>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Runs" value={String(stats.totalRuns)} />
          <StatCard
            label="Win Rate"
            value={winRatePct}
            className={winRateColor}
          />
          <StatCard label="Trades" value={String(stats.totalTrades)} />
          <StatCard label="P&L" value={pnlStr} className={pnlColor} />
        </div>

        {/* Inline collapsible config */}
        <div className="border-t pt-4">
          <InlineConfig config={config} />
        </div>

        {/* Run history */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Recent Runs</h2>
            {recentRuns.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {recentRuns.length} total
              </span>
            )}
          </div>
          <RunHistory runs={recentRuns} />
        </div>

        {/* Recent trades */}
        {recentTrades.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Recent Trades</h2>
              <Link
                href="/trades"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all →
              </Link>
            </div>
            <TradesList trades={recentTrades} />
          </div>
        )}
      </div>
    </div>
  );
}
