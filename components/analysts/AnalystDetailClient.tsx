"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { RunResearchButton } from "@/components/RunResearchButton";
import { StockLogo } from "@/components/StockLogo";
import { AnalystEditorChat } from "@/components/analysts/AnalystEditorChat";
import { ArrowLeft, Settings2 } from "lucide-react";
import type {
  AnalystDetail,
  TradeWithThesis,
} from "@/lib/actions/analyst.actions";
import type { ComposerRecentThesis } from "@/components/chat/ChatComposer";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

function fmtIsoLabel(d: string): string {
  if (d.length === 10 && d.includes("-")) {
    const dt = new Date(d + "T12:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d;
}

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
  range: Range
) {
  const cutoffMs = Date.now() - RANGE_DAYS[range] * 86_400_000;
  const filtered = data.filter(
    (d) => new Date(d.date + "T12:00:00").getTime() >= cutoffMs
  );
  return filtered.length > 1 ? filtered : data.slice(-2);
}

// ── Sidebar trade row ────────────────────────────────────────────────────────

function SidebarTradeRow({ trade }: { trade: TradeWithThesis }) {
  const pnl = trade.realizedPnl ?? 0;
  const isOpen = trade.status === "OPEN";

  return (
    <Link
      href={`/trades/${trade.id}`}
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 transition-colors"
    >
      <StockLogo ticker={trade.ticker} size="sm" />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-mono font-medium">{trade.ticker}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {trade.outcome ? (
          <>
            <span
              className={cn(
                "text-[10px] font-semibold",
                trade.outcome === "WIN" ? "text-emerald-500" : "text-red-500"
              )}
            >
              {trade.outcome === "WIN" ? "W" : "L"}
            </span>
            <span
              className={cn(
                "text-[10px] tabular-nums",
                pnl >= 0 ? "text-emerald-500" : "text-red-500"
              )}
            >
              {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(0)}
            </span>
          </>
        ) : isOpen ? (
          <span className="text-[10px] text-emerald-500 font-medium">Open</span>
        ) : null}
      </div>
    </Link>
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
      value: `$${config.maxPositionSize.toLocaleString()}`,
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
          {/* Key-value pairs */}
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

          {/* Sectors */}
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

          {/* Signals */}
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

          {/* Strategy Prompt */}
          {config.analystPrompt && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Strategy Prompt
              </p>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap">
                  {config.analystPrompt}
                </p>
              </div>
            </div>
          )}

          {/* Guidance */}
          <div className="rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              To edit any configuration, describe the changes you want in the AI
              chat. For example: &ldquo;Make this analyst focus on small-cap
              biotech with higher confidence&rdquo; or &ldquo;Switch to short
              bias with day-trade holding period.&rdquo;
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
  const { config, stats, recentRuns, recentTrades } = detail;
  const [configOpen, setConfigOpen] = useState(false);
  const [range, setRange] = useState<Range>("Max");

  // ── Chart data ──────────────────────────────────────────────────────────
  const equityData = useMemo(() => {
    const closed = recentTrades
      .filter((t) => t.closedAt && t.realizedPnl != null)
      .sort(
        (a, b) =>
          new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime()
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
    [equityData, range]
  );

  const equityStroke =
    equityData.length > 0 && equityData[equityData.length - 1].value >= 0
      ? "#10b981"
      : "#ef4444";

  // ── Display values ──────────────────────────────────────────────────────
  const pnlColor =
    stats.totalTrades > 0
      ? stats.totalPnl >= 0
        ? "text-emerald-500"
        : "text-red-500"
      : "text-muted-foreground";
  const pnlStr =
    stats.totalTrades > 0
      ? (stats.totalPnl >= 0 ? "+" : "") + formatCurrency(stats.totalPnl)
      : "$0.00";
  const winRatePct =
    stats.winRate != null ? `${Math.round(stats.winRate * 100)}%` : "—";
  const winRateColor =
    stats.winRate != null
      ? stats.winRate >= 0.5
        ? "text-emerald-500"
        : "text-red-500"
      : "text-muted-foreground";

  // ── Flattened theses for context summary + composer ─────────────────────
  const recentThesesCount = recentRuns.reduce(
    (sum, r) => sum + r.theses.length,
    0
  );

  const recentThesesFlat: ComposerRecentThesis[] = useMemo(() => {
    return recentRuns
      .flatMap((run) =>
        run.theses.map((t) => ({
          id: t.id,
          ticker: t.ticker,
          direction: t.direction,
          confidenceScore: t.confidenceScore,
          reasoningSummary: t.reasoningSummary,
          createdAt: run.startedAt,
        }))
      )
      .slice(0, 30);
  }, [recentRuns]);

  return (
    <>
      <div className="flex h-[calc(100dvh-5.25rem)] overflow-hidden">
        {/* ── Left sidebar: portfolio-style ─────────────────────────────── */}
        <div className="hidden md:flex w-64 shrink-0 border-r flex-col overflow-hidden">
          {/* Equity chart */}
          <div className="px-3 pt-4 pb-2 shrink-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1 mb-2">
              Performance
            </p>

            {equityData.length < 2 ? (
              <div className="h-[120px] rounded-lg border bg-muted/30 flex items-center justify-center">
                <p className="text-[10px] text-muted-foreground">
                  No closed trades yet
                </p>
              </div>
            ) : (
              <div
                className="relative rounded-lg overflow-hidden border"
                style={{
                  backgroundImage:
                    "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
                  backgroundSize: "18px 18px",
                  backgroundColor: "hsl(var(--muted)/0.3)",
                }}
              >
                {/* Range tabs */}
                <div className="absolute top-2 left-2 z-10 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border px-0.5 py-0.5">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={cn(
                        "px-1.5 py-0.5 text-[9px] rounded transition-colors",
                        range === r
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart
                    data={filteredEquity}
                    margin={{ top: 28, right: 0, bottom: 0, left: 0 }}
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
                          offset="5%"
                          stopColor={equityStroke}
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="95%"
                          stopColor={equityStroke}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={["dataMin - 50", "dataMax + 50"]} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        fontSize: "10px",
                        color: "var(--popover-foreground)",
                      }}
                      formatter={(v: unknown) => [
                        `$${Number(v).toFixed(2)}`,
                        "P&L",
                      ]}
                      labelFormatter={(l: unknown) =>
                        fmtIsoLabel(String(l))
                      }
                      labelStyle={{ color: "var(--muted-foreground)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={equityStroke}
                      strokeWidth={1.5}
                      fill="url(#analystEqGrad)"
                      dot={false}
                      activeDot={{ r: 2, fill: equityStroke }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* P&L + Win Rate row */}
          <div className="px-4 pb-3 shrink-0">
            <div className="flex items-end justify-between">
              <div>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    pnlColor
                  )}
                >
                  {pnlStr}
                </p>
                <p className="text-[10px] text-muted-foreground">Total P&L</p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    winRateColor
                  )}
                >
                  {winRatePct}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {stats.wins}W / {stats.losses}L
                </p>
              </div>
            </div>
          </div>

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
                <SidebarTradeRow key={trade.id} trade={trade} />
              ))
            )}
          </div>
        </div>

        {/* ── Right: Header + full-height AI chat ──────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href="/analysts"
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <span
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  config.enabled
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/40"
                )}
              />
              <h1 className="text-sm font-semibold truncate">
                {config.name}
              </h1>
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
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => setConfigOpen(true)}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              <RunResearchButton
                analystId={config.id}
                hasRunning={hasRunning}
              />
            </div>
          </div>

          {/* Context banner */}
          <div className="px-5 py-3 border-b shrink-0 bg-muted/20">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="tabular-nums">
                <span className="font-medium text-foreground">
                  {stats.totalRuns}
                </span>{" "}
                runs
              </span>
              <span className="text-border">·</span>
              <span className="tabular-nums">
                <span className="font-medium text-foreground">
                  {recentThesesCount}
                </span>{" "}
                theses
              </span>
              <span className="text-border">·</span>
              <span className="tabular-nums">
                <span className={cn("font-medium", pnlColor)}>
                  {pnlStr}
                </span>{" "}
                P&L
              </span>
              <span className="text-border">·</span>
              <span className="tabular-nums">
                <span className={cn("font-medium", winRateColor)}>
                  {winRatePct}
                </span>{" "}
                win rate
              </span>
              {stats.avgConfidence != null && (
                <>
                  <span className="text-border">·</span>
                  <span className="tabular-nums">
                    <span className="font-medium text-foreground">
                      {Math.round(stats.avgConfidence)}%
                    </span>{" "}
                    avg conf
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Full-height AI chat */}
          <div className="flex-1 min-h-0">
            <AnalystEditorChat
              analystId={config.id}
              currentConfig={{
                name: config.name,
                analystPrompt: config.analystPrompt ?? "",
                description: config.description ?? "",
                directionBias: config.directionBias,
                holdDurations: config.holdDurations,
                sectors: config.sectors,
                signalTypes: config.signalTypes,
                minConfidence: config.minConfidence,
                maxPositionSize: config.maxPositionSize,
                maxOpenPositions: config.maxOpenPositions,
              }}
              recentTheses={recentThesesFlat}
            />
          </div>
        </div>
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
