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
import { Card } from "@/components/ui/card";
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
import {
  ArrowLeft,
  Settings2,
  MessageSquare,
  X,
  ChevronDown,
  FileText,
  Sparkles,
} from "lucide-react";
import type {
  AnalystDetail,
  TradeWithThesis,
} from "@/lib/actions/analyst.actions";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  range: Range,
) {
  const cutoffMs = Date.now() - RANGE_DAYS[range] * 86_400_000;
  const filtered = data.filter(
    (d) => new Date(d.date + "T12:00:00").getTime() >= cutoffMs,
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
                trade.outcome === "WIN" ? "text-emerald-500" : "text-red-500",
              )}
            >
              {trade.outcome === "WIN" ? "W" : "L"}
            </span>
            <span
              className={cn(
                "text-[10px] tabular-nums",
                pnl >= 0 ? "text-emerald-500" : "text-red-500",
              )}
            >
              {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(0)}
            </span>
          </>
        ) : isOpen ? (
          <span className="text-[10px] text-emerald-500 font-medium">
            Open
          </span>
        ) : null}
      </div>
    </Link>
  );
}

// ── Strategy Document (the hero prompt) ──────────────────────────────────────

function StrategyDocument({
  config,
  fullSystemPrompt,
}: {
  config: AnalystDetail["config"];
  fullSystemPrompt?: string;
}) {
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const prompt = config.analystPrompt;
  const hasPrompt = !!prompt && prompt.trim().length > 0;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8 space-y-6">
        {/* Document header */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20 ring-1 ring-violet-500/30">
              <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{config.name}</h2>
              {config.description && (
                <p className="text-xs text-muted-foreground">
                  {config.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Strategy badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-xs h-6 px-2">
            {config.directionBias}
          </Badge>
          {config.holdDurations.map((d) => (
            <Badge key={d} variant="outline" className="text-xs h-6 px-2">
              {d}
            </Badge>
          ))}
          {config.sectors.slice(0, 5).map((s) => (
            <Badge key={s} variant="secondary" className="text-xs h-6 px-2">
              {s}
            </Badge>
          ))}
          {config.sectors.length > 5 && (
            <Badge variant="secondary" className="text-xs h-6 px-2">
              +{config.sectors.length - 5} more
            </Badge>
          )}
          <Badge
            variant="outline"
            className="text-xs h-6 px-2 font-mono tabular-nums"
          >
            {config.minConfidence}% min confidence
          </Badge>
          <Badge
            variant="outline"
            className="text-xs h-6 px-2 font-mono tabular-nums"
          >
            ${config.maxPositionSize.toLocaleString()} max
          </Badge>
        </div>

        {/* Signal types */}
        {config.signalTypes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Signal Types
            </p>
            <div className="flex flex-wrap gap-1">
              {config.signalTypes.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="text-[10px] px-2 py-0.5 font-mono"
                >
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Watchlist */}
        {config.watchlist.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Watchlist
            </p>
            <div className="flex flex-wrap gap-1">
              {config.watchlist.map((t) => (
                <Badge
                  key={t}
                  variant="secondary"
                  className="text-xs h-6 px-2 font-mono"
                >
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* The main strategy prompt */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Strategy Prompt
            </p>
          </div>

          {hasPrompt ? (
            <Card className="p-0 overflow-hidden">
              <div className="bg-muted/20 border-b px-4 py-2">
                <p className="text-[10px] font-medium text-muted-foreground">
                  This prompt is sent to the agent at the start of every research
                  run.
                </p>
              </div>
              <div className="p-5">
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed text-foreground/90">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => (
                        <h1 className="mb-2 scroll-m-20 font-semibold text-base first:mt-0 last:mb-0">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="mt-4 mb-2 scroll-m-20 font-semibold text-sm first:mt-0 last:mb-0">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="mt-3 mb-1 scroll-m-20 font-semibold text-sm first:mt-0 last:mb-0">
                          {children}
                        </h3>
                      ),
                      p: ({ children }) => (
                        <p className="my-2 leading-relaxed first:mt-0 last:mb-0">
                          {children}
                        </p>
                      ),
                      ul: ({ children }) => (
                        <ul className="my-2 ml-4 list-disc marker:text-muted-foreground [&>li]:mt-1">
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="my-2 ml-4 list-decimal marker:text-muted-foreground [&>li]:mt-1">
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => (
                        <li className="leading-relaxed">{children}</li>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold text-foreground">
                          {children}
                        </strong>
                      ),
                      em: ({ children }) => (
                        <em className="italic">{children}</em>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="my-2 border-muted-foreground/30 border-l-2 pl-3 text-muted-foreground italic">
                          {children}
                        </blockquote>
                      ),
                      hr: () => (
                        <hr className="my-3 border-muted-foreground/20" />
                      ),
                      code: ({ children }) => (
                        <code className="rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em]">
                          {children}
                        </code>
                      ),
                    }}
                  >
                    {prompt}
                  </ReactMarkdown>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-6 border-dashed">
              <div className="text-center space-y-2">
                <FileText className="h-8 w-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No strategy prompt yet
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Use the chat below to brainstorm and create a detailed strategy
                  prompt that will guide this analyst&apos;s research runs.
                </p>
              </div>
            </Card>
          )}
        </div>

        {/* Config details */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Risk & Position Rules
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              {
                label: "Max Positions",
                value: String(config.maxOpenPositions),
              },
              {
                label: "Max Risk",
                value: `${config.maxRiskPct}%`,
              },
              {
                label: "Min Market Cap",
                value: config.minMarketCapTier ?? "LARGE",
              },
              {
                label: "Schedule",
                value: config.scheduleTime,
              },
              {
                label: "Daily Loss Limit",
                value: `$${config.dailyLossLimit.toLocaleString()}`,
              },
              {
                label: "Direction",
                value: config.directionBias,
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg border bg-muted/20 px-3 py-2"
              >
                <p className="text-[10px] text-muted-foreground mb-0.5">
                  {label}
                </p>
                <p className="text-xs font-medium tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Full System Prompt viewer */}
        {fullSystemPrompt && (
          <div className="space-y-3">
            <button
              onClick={() => setShowSystemPrompt(!showSystemPrompt)}
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  showSystemPrompt && "rotate-180"
                )}
              />
              Full Agent System Prompt
            </button>
            {showSystemPrompt && (
              <Card className="p-0 overflow-hidden">
                <div className="bg-muted/30 border-b px-4 py-2">
                  <p className="text-[10px] font-medium text-muted-foreground">
                    This is the complete system prompt sent to GPT-4o at the start of every research run.
                    It includes your strategy prompt, rules, and the agent&apos;s operating instructions.
                  </p>
                </div>
                <pre className="p-4 text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed max-h-[600px] overflow-y-auto">
                  {fullSystemPrompt}
                </pre>
              </Card>
            )}
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
  fullSystemPrompt,
}: {
  detail: AnalystDetail;
  hasRunning: boolean;
  fullSystemPrompt?: string;
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
  const [chatExpanded, setChatExpanded] = useState(false);
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
                <div className="absolute top-2 left-2 z-10 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border px-0.5 py-0.5">
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
                    pnlColor,
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
                    winRateColor,
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

        {/* ── Right: Strategy prompt hero + floating chat ──────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
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

          {/* Context stats banner */}
          <div className="px-5 py-2.5 border-b shrink-0 bg-muted/20">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="tabular-nums">
                <span className="font-medium text-foreground">
                  {stats.totalRuns}
                </span>{" "}
                runs
              </span>
              <span className="text-border">·</span>
              <span className="tabular-nums">
                <span className={cn("font-medium", pnlColor)}>{pnlStr}</span>{" "}
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

          {/* ── Content area: Strategy doc OR full chat ─────────────────── */}
          {chatExpanded ? (
            /* Full-page chat mode */
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between px-5 py-2 border-b bg-muted/10 shrink-0">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">
                    Chat with {config.name}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => setChatExpanded(false)}
                >
                  <X className="h-3 w-3 mr-1" />
                  Close Chat
                </Button>
              </div>
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
                    minMarketCapTier: config.minMarketCapTier ?? "LARGE",
                  }}
                />
              </div>
            </div>
          ) : (
            /* Strategy document view with floating chat trigger */
            <>
              <StrategyDocument config={config} fullSystemPrompt={fullSystemPrompt} />

              {/* Floating chat trigger */}
              <div className="absolute bottom-6 right-6 z-10">
                <Button
                  onClick={() => setChatExpanded(true)}
                  className="h-12 rounded-full px-5 shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    Edit with AI
                  </span>
                </Button>
              </div>
            </>
          )}
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
