"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RunResearchButton } from "@/components/RunResearchButton";
import { StockLogo } from "@/components/StockLogo";
import {
  ArrowLeft,
  Pencil,
} from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import type {
  AnalystDetail,
  RunWithTheses,
  TradeWithThesis,
} from "@/lib/actions/analyst.actions";
import { updateAnalystPrompt } from "@/lib/actions/analyst.actions";
import { cn } from "@/lib/utils";

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

// ── Mini sparkline ────────────────────────────────────────────────────────────

function MiniSparkline({ trades }: { trades: TradeWithThesis[] }) {
  const data = useMemo(() => {
    const closed = trades
      .filter((t) => t.closedAt && t.realizedPnl != null)
      .sort(
        (a, b) =>
          new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime()
      );
    if (closed.length < 2) return [];
    let cum = 0;
    return closed.map((t) => {
      cum += t.realizedPnl!;
      return { v: cum };
    });
  }, [trades]);

  if (data.length < 2) {
    return (
      <div className="h-14 flex items-center justify-center">
        <p className="text-[10px] text-muted-foreground text-center px-2">
          No closed trades yet
        </p>
      </div>
    );
  }

  const isPositive = data[data.length - 1].v >= 0;
  const strokeColor = isPositive ? "#10b981" : "#ef4444";

  return (
    <ResponsiveContainer width="100%" height={56}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={strokeColor}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Sidebar: trade row ────────────────────────────────────────────────────────

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
          <span className="text-[10px] text-amber-500 font-medium">Open</span>
        ) : null}
      </div>
    </Link>
  );
}

// ── Sidebar: run row ──────────────────────────────────────────────────────────

function SidebarRunRow({ run }: { run: RunWithTheses }) {
  const tickerPills = run.theses.slice(0, 4);
  const overflow = run.theses.length - 4;
  const tradeCount = run.theses.filter((t) => t.trade).length;

  const statusColor =
    run.status === "COMPLETE"
      ? "bg-emerald-500"
      : run.status === "RUNNING"
      ? "bg-amber-500 animate-pulse"
      : "bg-red-400";

  return (
    <Link
      href={`/runs/${run.id}`}
      className="block px-2 py-1.5 rounded hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusColor}`} />
        <span className="text-[10px] text-muted-foreground">
          {formatRelativeTime(run.startedAt)}
        </span>
        {tradeCount > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {tradeCount}t
          </span>
        )}
      </div>
      {tickerPills.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {tickerPills.map((t) => (
            <span
              key={t.id}
              className="text-[9px] font-mono bg-muted px-1 py-0.5 rounded"
            >
              {t.ticker}
            </span>
          ))}
          {overflow > 0 && (
            <span className="text-[9px] text-muted-foreground">+{overflow}</span>
          )}
        </div>
      )}
    </Link>
  );
}

// ── Prompt renderer (minimal markdown: # headers, ## subheaders) ──────────────

function PromptRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <p key={i} className="text-sm font-semibold mt-3 first:mt-0">
              {line.slice(3)}
            </p>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <p key={i} className="text-base font-semibold mt-3 first:mt-0">
              {line.slice(2)}
            </p>
          );
        }
        if (line === "") {
          return <div key={i} className="h-2" />;
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-foreground/90">
            {line}
          </p>
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
  recentTheses: {
    id: string;
    ticker: string;
    direction: string;
    confidenceScore: number;
    reasoningSummary: string;
    createdAt: Date;
  }[];
  hasRunning: boolean;
}) {
  const router = useRouter();
  const { config, stats, recentRuns, recentTrades } = detail;

  // Prompt editing state
  const [editing, setEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState(config.analystPrompt ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateAnalystPrompt(config.id, promptDraft);
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditing(false);
    setPromptDraft(config.analystPrompt ?? "");
  }

  // Derived display values
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
    <div className="flex h-[calc(100dvh-5.25rem)] overflow-hidden">

      {/* ── Left sidebar: sparkline + trades/runs tabs ─────────────────────── */}
      <div className="hidden md:flex w-60 shrink-0 border-r flex-col overflow-hidden">

        {/* Sparkline */}
        <div className="px-2 pt-4 pb-2 shrink-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-2 mb-1">
            Lifetime P&amp;L
          </p>
          <MiniSparkline trades={recentTrades} />
          {stats.totalTrades > 0 && (
            <div className="flex items-center justify-between px-2 mt-1">
              <span className={cn("text-[10px] tabular-nums font-semibold", pnlColor)}>
                {pnlStr}
              </span>
              <span className={cn("text-[10px] tabular-nums", winRateColor)}>
                {winRatePct} win
              </span>
            </div>
          )}
        </div>

        <div className="h-px bg-border shrink-0" />

        {/* Trades / Runs tabs */}
        <Tabs defaultValue="trades" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-2 mt-2 shrink-0 w-auto self-start h-7">
            <TabsTrigger value="trades" className="text-xs h-6 px-2">
              Trades
            </TabsTrigger>
            <TabsTrigger value="runs" className="text-xs h-6 px-2">
              Runs
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="trades"
            className="flex-1 overflow-y-auto mt-1 px-1 pb-2 data-[state=inactive]:hidden"
          >
            {recentTrades.length === 0 ? (
              <p className="text-[10px] text-muted-foreground text-center py-6 px-2">
                No trades yet
              </p>
            ) : (
              recentTrades.map((trade) => (
                <SidebarTradeRow key={trade.id} trade={trade} />
              ))
            )}
          </TabsContent>

          <TabsContent
            value="runs"
            className="flex-1 overflow-y-auto mt-1 px-1 pb-2 data-[state=inactive]:hidden"
          >
            {recentRuns.length === 0 ? (
              <p className="text-[10px] text-muted-foreground text-center py-6 px-2">
                No runs yet
              </p>
            ) : (
              recentRuns.map((run) => (
                <SidebarRunRow key={run.id} run={run} />
              ))
            )}
          </TabsContent>
        </Tabs>

      </div>

      {/* ── Right: main content ─────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href="/analysts"
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                config.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
              )}
            />
            <h1 className="text-xl font-semibold truncate">{config.name}</h1>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <RunResearchButton analystId={config.id} hasRunning={hasRunning} />
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Runs", value: String(stats.totalRuns) },
            { label: "Theses", value: String(stats.totalTheses) },
            { label: "Win Rate", value: winRatePct, cls: winRateColor },
            { label: "P&L", value: pnlStr, cls: pnlColor },
          ].map(({ label, value, cls }) => (
            <div key={label} className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className={cn("text-sm font-semibold tabular-nums", cls ?? "text-foreground")}>
                {value}
              </p>
            </div>
          ))}
        </div>

        <div className="h-px bg-border" />

        {/* Inline config — full readable breakdown */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Configuration
          </p>

          {/* Key settings grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Direction</p>
              <p className="text-sm font-medium">{config.directionBias}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Hold Duration</p>
              <p className="text-sm font-medium">{config.holdDurations.join(", ") || "—"}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Min Confidence</p>
              <p className="text-sm font-medium tabular-nums">{config.minConfidence}%</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Schedule</p>
              <p className="text-sm font-medium">{config.scheduleTime}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Max Positions</p>
              <p className="text-sm font-medium tabular-nums">{config.maxOpenPositions}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Max Position Size</p>
              <p className="text-sm font-medium tabular-nums">${config.maxPositionSize.toLocaleString()}</p>
            </div>
          </div>

          {/* Sectors */}
          {config.sectors.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Sectors</p>
              <div className="flex flex-wrap gap-1">
                {config.sectors.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[10px] px-1.5 py-0.5">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Signals */}
          {config.signalTypes.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Signals</p>
              <div className="flex flex-wrap gap-1">
                {config.signalTypes.map((s) => (
                  <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0.5 font-mono">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* Strategy prompt — hero section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Strategy Prompt
            </p>
            {!editing && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 text-muted-foreground"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            )}
          </div>

          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                placeholder="Describe what this analyst should look for...&#10;&#10;Use # headers to organize sections.&#10;Example:&#10;# Focus&#10;High momentum EV stocks with unusual options activity."
                className="min-h-[240px] text-sm font-mono resize-y"
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs">
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : promptDraft ? (
            <div
              className="cursor-pointer rounded-lg p-4 border hover:border-border/80 hover:bg-muted/20 transition-colors"
              onClick={() => setEditing(true)}
            >
              <PromptRenderer text={promptDraft} />
            </div>
          ) : (
            <button
              className="w-full text-left px-4 py-8 rounded-lg border border-dashed text-sm text-muted-foreground/50 hover:text-muted-foreground hover:border-border transition-colors"
              onClick={() => setEditing(true)}
            >
              Click to add a strategy prompt for this analyst…
            </button>
          )}
        </div>

      </div>

    </div>
  );
}
