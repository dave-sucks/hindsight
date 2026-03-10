"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import ResearchChatFull from "@/components/ResearchChatFull";
import { RunResearchButton } from "@/components/RunResearchButton";
import {
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Settings,
} from "lucide-react";
import type {
  AnalystDetail,
  AnalystConfig,
  RunWithTheses,
  TradeWithThesis,
  AnalystStats,
} from "@/lib/actions/analyst.actions";

// ── Types (local) ─────────────────────────────────────────────────────────────

type RecentThesis = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  reasoningSummary: string;
  createdAt: Date;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
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

// ── Config Sheet ──────────────────────────────────────────────────────────────

function ConfigSheet({
  config,
  stats,
}: {
  config: AnalystConfig;
  stats: AnalystStats;
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" />
        }
      >
        <Settings className="h-4 w-4" />
        <span className="sr-only">Analyst config</span>
      </SheetTrigger>
      <SheetContent className="w-[360px] overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>Analyst Config</SheetTitle>
        </SheetHeader>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { label: "Total Runs", value: String(stats.totalRuns) },
            { label: "Theses", value: String(stats.totalTheses) },
            {
              label: "Win Rate",
              value:
                stats.winRate != null
                  ? `${Math.round(stats.winRate * 100)}%`
                  : "—",
              className:
                stats.winRate != null
                  ? stats.winRate >= 0.5
                    ? "text-emerald-500"
                    : "text-red-500"
                  : "text-muted-foreground",
            },
            {
              label: "Total P&L",
              value:
                stats.totalTrades > 0 ? formatCurrency(stats.totalPnl) : "—",
              className:
                stats.totalTrades > 0
                  ? stats.totalPnl >= 0
                    ? "text-emerald-500"
                    : "text-red-500"
                  : "text-muted-foreground",
            },
          ].map(({ label, value, className }) => (
            <Card key={label}>
              <CardContent className="p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  {label}
                </p>
                <p
                  className={`text-lg font-semibold tabular-nums ${
                    className ?? "text-foreground"
                  }`}
                >
                  {value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Strategy params */}
        <div className="space-y-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Strategy
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
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
              { label: "Max Risk %", value: `${config.maxRiskPct}%` },
              { label: "Schedule", value: config.scheduleTime },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-medium tabular-nums text-sm">{value}</p>
              </div>
            ))}
          </div>

          {config.sectors.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">Sectors</p>
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
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">Signal Types</p>
              <div className="flex flex-wrap gap-1.5">
                {config.signalTypes.map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">
                    {s.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {config.analystPrompt && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-1.5">
                Analyst Prompt
              </p>
              <p className="text-xs text-foreground/80 italic leading-relaxed">
                &ldquo;{config.analystPrompt}&rdquo;
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Runs Tab ──────────────────────────────────────────────────────────────────

function RunCard({ run }: { run: RunWithTheses }) {
  const tradeCount = run.theses.filter((t) => t.trade).length;
  const actionableCount = run.theses.filter((t) => t.direction !== "PASS").length;

  return (
    <Link href={`/runs/${run.id}`} className="block">
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <Badge
                variant={run.source === "AGENT" ? "default" : "secondary"}
                className="text-[10px]"
              >
                {run.source}
              </Badge>
              {run.status === "RUNNING" && (
                <Badge
                  variant="outline"
                  className="text-amber-500 border-amber-500/30 text-[10px]"
                >
                  Running
                </Badge>
              )}
              {run.status === "FAILED" && (
                <Badge variant="destructive" className="text-[10px]">
                  Failed
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(run.startedAt)} &middot;{" "}
              {run.theses.length} analyzed &middot; {actionableCount} recommended
              {tradeCount > 0 && ` · ${tradeCount} trades`}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}

function AnalystRunsTab({ runs }: { runs: RunWithTheses[] }) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-muted-foreground">
        <p className="text-sm font-medium text-foreground">No runs yet</p>
        <p className="text-sm">
          Click &ldquo;Run Now&rdquo; above to start a research run
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-w-2xl">
      {runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
    </div>
  );
}

// ── Trades Tab ────────────────────────────────────────────────────────────────

function AnalystTradesTab({ trades }: { trades: TradeWithThesis[] }) {
  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-muted-foreground">
        <p className="text-sm font-medium text-foreground">No trades yet</p>
        <p className="text-sm">
          Trades will appear here once this analyst generates actionable theses
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-1">
      {trades.map((trade) => {
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
                        trade.closedAt ? formatRelativeTime(trade.closedAt) : ""
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

// ── Tab param reader ──────────────────────────────────────────────────────────

function TabParamReader({
  children,
}: {
  children: (defaultTab: string) => React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") ?? "chat";
  return <>{children(defaultTab)}</>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystDetailClient({
  detail,
  userId,
  recentTheses,
  hasRunning,
}: {
  detail: AnalystDetail;
  userId: string;
  recentTheses: RecentThesis[];
  hasRunning: boolean;
}) {
  const winRatePct =
    detail.stats.winRate != null
      ? `${Math.round(detail.stats.winRate * 100)}%`
      : null;

  return (
    <div className="h-[calc(100dvh-5.25rem)] flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/analysts"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              ← Analysts
            </Link>
            <span className="text-muted-foreground/40 shrink-0">/</span>
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`h-2 w-2 rounded-full shrink-0 ${
                  detail.config.enabled
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/40"
                }`}
              />
              <h1 className="text-base font-semibold truncate">
                {detail.config.name}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Mini stats */}
            {detail.stats.totalTrades > 0 && (
              <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground tabular-nums border-r pr-3 mr-1">
                {winRatePct && (
                  <span
                    className={
                      detail.stats.winRate! >= 0.5
                        ? "text-emerald-500"
                        : "text-red-500"
                    }
                  >
                    {winRatePct} WR
                  </span>
                )}
                <span>{detail.stats.totalTrades} trades</span>
                <span
                  className={
                    detail.stats.totalPnl >= 0
                      ? "text-emerald-500"
                      : "text-red-500"
                  }
                >
                  {detail.stats.totalPnl >= 0 ? "+" : ""}
                  {formatCurrency(detail.stats.totalPnl)}
                </span>
              </div>
            )}

            <ConfigSheet config={detail.config} stats={detail.stats} />
            <RunResearchButton
              analystId={detail.config.id}
              hasRunning={hasRunning}
            />
          </div>
        </div>

        {detail.config.analystPrompt && (
          <p className="text-xs text-muted-foreground mt-1.5 italic pl-[calc(1.25rem+2ch+0.75rem)]">
            {detail.config.analystPrompt}
          </p>
        )}
      </div>

      {/* Tabs — Chat | Runs | Trades */}
      <Suspense
        fallback={
          <div className="px-6 mt-3">
            <Skeleton className="h-9 w-56" />
          </div>
        }
      >
        <TabParamReader>
          {(defaultTab) => (
            <Tabs
              defaultValue={defaultTab}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <TabsList className="mx-6 mt-3 w-fit shrink-0">
                <TabsTrigger value="chat">Chat</TabsTrigger>
                <TabsTrigger value="runs">
                  Runs ({detail.recentRuns.length})
                </TabsTrigger>
                <TabsTrigger value="trades">
                  Trades ({detail.stats.totalTrades})
                </TabsTrigger>
              </TabsList>

              {/* Chat — ResearchChatFull fills height */}
              <TabsContent
                value="chat"
                className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden"
              >
                <ResearchChatFull
                  userId={userId}
                  recentTheses={recentTheses}
                  hasRunning={hasRunning}
                  analystId={detail.config.id}
                  className="flex flex-col h-full"
                />
              </TabsContent>

              {/* Runs */}
              <TabsContent
                value="runs"
                className="flex-1 overflow-y-auto px-6 py-4 mt-0"
              >
                <AnalystRunsTab runs={detail.recentRuns} />
              </TabsContent>

              {/* Trades */}
              <TabsContent
                value="trades"
                className="flex-1 overflow-y-auto px-6 py-4 mt-0"
              >
                <AnalystTradesTab trades={detail.recentTrades} />
              </TabsContent>
            </Tabs>
          )}
        </TabParamReader>
      </Suspense>
    </div>
  );
}
