"use client";

import { useState, useMemo } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { RunResearchButton } from "@/components/RunResearchButton";
import { TradeRow } from "@/components/ui/trade-row";
import { Markdown } from "@/components/ui/markdown";
import {
  Settings2,
  FileText,
} from "lucide-react";
import type {
  AnalystDetail,
  TradeWithThesis,
} from "@/lib/actions/analyst.actions";
import { cn, pnlColor, PNL_HEX, pnlBadgeClasses } from "@/lib/utils";
import { formatCurrency, formatDateLabel } from "@/lib/format";

// ── Helpers ───────────────────────────────────────────────────────────────────

const RANGES = ["1W", "1M", "3M", "1Y", "Max"] as const;
type Range = (typeof RANGES)[number];

const RANGE_DAYS: Record<Range, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  Max: 99999,
};

function sliceByRange(
  data: { date: string; value: number }[],
  range: Range,
) {
  const cutoffMs = Date.now() - RANGE_DAYS[range] * 86_400_000;
  const filtered = data.filter(
    (d) => new Date(d.date + "T12:00:00").getTime() >= cutoffMs,
  );
  return filtered.length > 1 ? filtered : data.slice(-2);
}

// ── Sidebar trade row (uses shared TradeRow component) ───────────────────────

function AnalystTradeRow({ trade }: { trade: TradeWithThesis }) {
  const pnl = trade.realizedPnl ?? 0;
  const price = trade.closePrice ?? trade.entryPrice;
  const pnlPct =
    trade.entryPrice > 0
      ? ((price - trade.entryPrice) / trade.entryPrice) * 100 *
        (trade.direction === "SHORT" ? -1 : 1)
      : 0;

  return (
    <TradeRow
      id={trade.id}
      ticker={trade.ticker}
      currentPrice={price}
      shares={trade.shares}
      pnl={pnl}
      pnlPct={pnlPct}
      status={trade.status}
    />
  );
}

// ── Strategy Document (the hero prompt) ──────────────────────────────────────

function StrategyDocument({
  config,
}: {
  config: AnalystDetail["config"];
}) {
  const prompt = config.analystPrompt;
  const hasPrompt = !!prompt && prompt.trim().length > 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10">
        {hasPrompt ? (
          <Markdown variant="prose">{prompt}</Markdown>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <FileText className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              No strategy prompt yet
            </p>
            <p className="text-xs text-muted-foreground/70 max-w-sm text-center">
              Use the chat below to brainstorm and create a detailed strategy
              prompt that will guide this analyst&apos;s research runs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Config Sheet ──────────────────────────────────────────────────────────────

function ConfigSheet({
  open,
  onOpenChange,
  config,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AnalystDetail["config"];
}) {
  const configRows = [
    { label: "Direction", value: config.directionBias },
    {
      label: "Hold Duration",
      value: config.holdDurations.join(", ") || "—",
    },
    { label: "Min Confidence", value: `${config.minConfidence}%` },
    { label: "Schedule", value: config.scheduleTime },
    { label: "Max Positions", value: String(config.maxOpenPositions) },
    {
      label: "Max Position Size",
      value: `$${(config.maxPositionSize ?? 0).toLocaleString()}`,
    },
    { label: "Max Risk %", value: `${config.maxRiskPct}%` },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="text-sm font-semibold">
            Configuration
          </SheetTitle>
          <SheetDescription className="text-xs">
            Use the AI chat to edit these settings.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-5">
          <div className="space-y-0.5">
            {configRows.map(({ label, value }) => (
              <div
                key={label}
                className="flex items-center justify-between text-sm border-b border-border pb-1.5 pt-1.5"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium tabular-nums">{value}</span>
              </div>
            ))}
          </div>

          {config.sectors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Sectors
              </p>
              <div className="flex flex-wrap gap-1">
                {config.sectors.map((s) => (
                  <Badge
                    key={s}
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0.5"
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {config.signalTypes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Signals
              </p>
              <div className="flex flex-wrap gap-1">
                {config.signalTypes.map((s) => (
                  <Badge
                    key={s}
                    variant="outline"
                    className="text-[10px] px-1.5 py-0.5 font-mono"
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              To edit any configuration, describe the changes you want in the AI
              chat. For example: &ldquo;Make this analyst focus on small-cap
              biotech with higher confidence&rdquo;
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystDetailClient({
  detail,
  hasRunning,
}: {
  detail: AnalystDetail;
  hasRunning: boolean;
}) {
  const { config: rawConfig, stats, recentRuns, recentTrades } = detail;

  // Defensive defaults for array fields that may be missing from older data
  const config = useMemo(() => ({
    ...rawConfig,
    sectors: rawConfig.sectors ?? [],
    signalTypes: rawConfig.signalTypes ?? [],
    holdDurations: rawConfig.holdDurations ?? [],
    watchlist: rawConfig.watchlist ?? [],
    exclusionList: rawConfig.exclusionList ?? [],
    dailyLossLimit: rawConfig.dailyLossLimit ?? 0,
  }), [rawConfig]);

  const [configOpen, setConfigOpen] = useState(false);
  const [range, setRange] = useState<Range>("Max");

  // ── Chart data ──────────────────────────────────────────────────────────
  const equityData = useMemo(() => {
    const closed = recentTrades
      .filter((t) => t.closedAt && t.realizedPnl != null)
      .sort(
        (a, b) =>
          new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime(),
      );
    if (closed.length < 2) return [];
    let cum = 0;
    return closed.map((t) => {
      cum += t.realizedPnl!;
      return {
        date: new Date(t.closedAt!).toISOString().slice(0, 10),
        value: cum,
      };
    });
  }, [recentTrades]);

  const filteredEquity = useMemo(
    () => sliceByRange(equityData, range),
    [equityData, range],
  );

  const equityStroke =
    equityData.length > 0 && equityData[equityData.length - 1].value >= 0
      ? PNL_HEX.positive
      : PNL_HEX.negative;

  // ── Display values ──────────────────────────────────────────────────────
  const pnlColor =
    stats.totalTrades > 0
      ? stats.totalPnl >= 0
        ? "text-positive"
        : "text-negative"
      : "text-muted-foreground";
  const pnlStr =
    stats.totalTrades > 0
      ? (stats.totalPnl >= 0 ? "+" : "") + formatCurrency(stats.totalPnl)
      : "$0.00";

  return (
    <>
      <div className="grid lg:grid-cols-3 h-[calc(100dvh-3rem)] overflow-hidden">
        {/* ── Left: Strategy prompt hero ───────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col overflow-y-auto relative">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  config.enabled
                    ? "bg-positive"
                    : "bg-muted-foreground/40",
                )}
              />
              <h1 className="text-sm font-semibold truncate">{config.name}</h1>
              {hasRunning && (
                <Badge
                  variant="secondary"
                  className="text-[10px] h-5 px-2 shrink-0 animate-pulse"
                >
                  Research Running…
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfigOpen(true)}
              >
                <Settings2 />
              </Button>
              <RunResearchButton
                analystId={config.id}
                hasRunning={hasRunning}
              />
            </div>
          </div>

          {/* ── Strategy document (always visible) ──────────────────────── */}
          <StrategyDocument config={config} />
        </div>
        {/* ── Right sidebar: portfolio-style ─────────────────────────────── */}
        <div className="p-4 h-full">
          <div className="h-full rounded-xl border bg-background overflow-y-auto">
            {/* Equity chart */}
            {equityData.length < 2 ? (
              <div className="h-[200px] bg-muted/30 flex items-center justify-center shrink-0">
                <p className="text-[10px] text-muted-foreground">
                  No closed trades yet
                </p>
              </div>
            ) : (
              <div className="relative shrink-0">
                {/* P&L + Win Rate overlay */}
                <div className="absolute top-2 left-2 right-2 z-10 flex items-start justify-between">
                  <div>
                    <p
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        pnlColor,
                      )}
                    >
                      {pnlStr}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Lifetime</p>
                  </div>
                  {stats.winRate != null && (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium tabular-nums",
                        pnlBadgeClasses(stats.winRate - 0.5),
                      )}
                    >
                      {Math.round(stats.winRate * 100)}% Success
                    </span>
                  )}
                </div>
                {/* Range tabs */}
                <div className="absolute bottom-2 left-2 z-10 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border px-0.5 py-0.5">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={cn(
                        "px-1.5 py-0.5 text-[9px] rounded transition-colors",
                        range === r
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                <ChartContainer
                  config={{
                    value: {
                      label: "P&L",
                      color: equityStroke,
                    },
                  } satisfies ChartConfig}
                  className="h-[200px] w-full"
                >
                  <AreaChart
                    data={filteredEquity}
                    margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="analystEqGrad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={equityStroke}
                          stopOpacity={0.15}
                        />
                        <stop
                          offset="100%"
                          stopColor={equityStroke}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={["dataMin - 50", "dataMax + 50"]} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(l) => formatDateLabel(String(l))}
                          formatter={(value) => (
                            <span className="font-mono text-xs tabular-nums">
                              ${Number(value).toFixed(2)}
                            </span>
                          )}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={equityStroke}
                      strokeWidth={1.5}
                      fill="url(#analystEqGrad)"
                      baseValue="dataMin"
                      dot={false}
                      activeDot={{ r: 2, fill: equityStroke }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            )}

            {/* Stats strip */}
            <div className="grid grid-cols-3 border-t border-b shrink-0">
              {[
                { label: "Runs", value: String(stats.totalRuns) },
                { label: "Theses", value: String(stats.totalTheses) },
                { label: "Trades", value: String(stats.totalTrades) },
              ].map(({ label, value }) => (
                <div key={label} className="px-2 py-2 text-center">
                  <p className="text-xs font-medium tabular-nums">{value}</p>
                  <p className="text-[9px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {/* Trade rows */}
            <div className="flex-1 overflow-y-auto px-1 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-2 mb-1">
                Trades
              </p>
              {recentTrades.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-6 px-2">
                  No trades yet
                </p>
              ) : (
                recentTrades.map((trade) => (
                  <AnalystTradeRow key={trade.id} trade={trade} />
                ))
              )}
            </div>
          </div>
        </div>
        {/* End Sidebar */}
      </div>

      {/* Config Sheet */}
      <ConfigSheet
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
      />
    </>
  );
}
