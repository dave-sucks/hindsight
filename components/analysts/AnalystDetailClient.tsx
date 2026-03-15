"use client";

import { useState, useMemo, useCallback, useRef, useTransition } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnalystConfigSheet } from "@/components/analysts/AnalystConfigSheet";
import { StockCombobox } from "@/components/analysts/StockCombobox";
import { StockLogo } from "@/components/StockLogo";
import {
  addToWatchlist,
  removeFromWatchlist,
} from "@/lib/actions/analyst.actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RunResearchButton } from "@/components/RunResearchButton";
import { TradeRow } from "@/components/ui/trade-row";
import { Markdown } from "@/components/ui/markdown";
import { BriefingFeed } from "@/components/analysts/BriefingFeed";
import {
  Settings2,
  FileText,
  Eye,
  X,
} from "lucide-react";
import type {
  AnalystDetail,
  TradeWithThesis,
} from "@/lib/actions/analyst.actions";
import { cn, PNL_HEX, pnlBadgeClasses } from "@/lib/utils";
import { formatCurrency, formatDateLabel } from "@/lib/format";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

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

// ── Watching row for sidebar ──────────────────────────────────────────────────

function WatchingRow({
  symbol,
  onRemove,
}: {
  symbol: string;
  onRemove: (symbol: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border/40 last:border-0">
      <StockLogo ticker={symbol} size="md" className="rounded-md" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">{symbol}</span>
      </div>
      <button
        onClick={() => onRemove(symbol)}
        className="p-1 rounded hover:bg-accent/40 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Floating composer (redirects to editor page on send) ─────────────────

function FloatingEditorComposer({ analystId }: { analystId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const msg = text.trim();
    if (!msg) return;
    router.push(`/analysts/${analystId}/edit?message=${encodeURIComponent(msg)}`);
  }, [text, analystId, router]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return ( 
    <div className="max-w-3xl mx-auto z-10">
      <div className="bg-background/80 backdrop-blur-sm border border-border rounded-lg overflow-hidden transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <div className="px-3 pt-3 pb-2 grow">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or suggest strategy changes…"
            rows={1}
            className="w-full bg-transparent! p-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder-muted-foreground resize-none border-none outline-none text-sm min-h-10 max-h-[25vh]"
          />
        </div>
        <div className="mb-2 px-2 flex items-center justify-end">
          <Button
            size="icon-sm"
            disabled={!text.trim()}
            onClick={handleSend}
            aria-label="Send message"
          >
            <Send className="size-3" />
          </Button>
        </div>
      </div>
    </div>
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
  const { config: rawConfig, stats, recentTrades } = detail;

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
  const [watchlist, setWatchlist] = useState(config.watchlist);
  const [, startTransition] = useTransition();

  const handleAddStock = (symbol: string) => {
    const upper = symbol.toUpperCase();
    if (watchlist.includes(upper)) return;
    setWatchlist((prev) => [...prev, upper]);
    startTransition(async () => {
      await addToWatchlist(config.id, upper);
    });
  };

  const handleRemoveStock = (symbol: string) => {
    setWatchlist((prev) => prev.filter((s) => s !== symbol));
    startTransition(async () => {
      await removeFromWatchlist(config.id, symbol);
    });
  };

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
  const pnlColorClass =
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
        {/* ── Left: Analyst briefing hero ───────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col overflow-hidden relative">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 p-4 shrink-0">
            {/* Left Side Analyst Name */}
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-base font-brand font-semibold truncate">{config.name}</h1>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    config.enabled
                      ? "bg-positive"
                      : "bg-muted-foreground/40",
                  )}
                />
                {hasRunning && (
                  <Badge
                    variant="secondary"
                  >
                    Research Running…
                  </Badge>
                )}
              </div>
              {/* Stats strip */}
              <div className="flex items-center gap-3 flex-wrap">
                {[
                  { label: "Runs", value: String(stats.totalRuns) },
                  { label: "Theses", value: String(stats.totalTheses) },
                  { label: "Trades", value: String(stats.totalTrades) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex gap-1 font-mono text-[11px] uppercase text-muted-foreground leading-tight">
                    <p className="tabular-nums">{value}</p>
                    <p >{label}</p>
                  </div>
                ))}
              </div>
            </div>
            {/* Right Side Settings and Run Research Button */}
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
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* ── Tabs: Briefings | Overview ───── */}
            <Tabs defaultValue={0} className="flex-1 overflow-hidden">
              <div className="px-4 shrink-0">
                <TabsList>
                  <TabsTrigger value={0}>
                    Briefings
                    {detail.briefings.length > 0 && (
                      <span className="text-[10px] tabular-nums text-muted-foreground ml-1">
                        {detail.briefings.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value={1}>Overview</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value={0} className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-8 py-6">
                  <BriefingFeed briefings={detail.briefings} />
                </div>
              </TabsContent>
              <TabsContent value={1} className="flex-1 overflow-y-auto">
                <div className="flex-1 overflow-y-auto">
                  <div className="max-w-3xl mx-auto px-8 py-6">
                    {config.analystPrompt && config.analystPrompt.trim().length > 0 ? (
                      <Markdown variant="prose">{config.analystPrompt}</Markdown>
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
              </TabsContent>
            </Tabs>

            {/* ── Floating composer — sends first message to editor page ── */}
            <div className="sticky bottom-0 px-4 pb-4 bg-transparent">
              <FloatingEditorComposer analystId={config.id} />
            </div>
            

          </div>
        </div>
        {/* ── Right sidebar: portfolio-style ─────────────────────────────── */}
        <div className="p-4 h-full">
          <div className="h-full rounded-xl border bg-background overflow-hidden flex flex-col">
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
                        pnlColorClass,
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

            {/* Sidebar tabs: Trades | Watching */}
            <Tabs defaultValue={0} className="flex-1 overflow-hidden">
              <div className="px-3 pt-2 shrink-0">
                <TabsList>
                  <TabsTrigger value={0}>
                    Trades
                    {recentTrades.length > 0 && (
                      <span className="text-[10px] tabular-nums text-muted-foreground ml-1">
                        {recentTrades.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value={1}>
                    Watching
                    {watchlist.length > 0 && (
                      <span className="text-[10px] tabular-nums text-muted-foreground ml-1">
                        {watchlist.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value={0} className="flex-1 overflow-y-auto">
                {recentTrades.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center py-6 px-2">
                    No trades yet
                  </p>
                ) : (
                  recentTrades.map((trade) => (
                    <AnalystTradeRow key={trade.id} trade={trade} />
                  ))
                )}
              </TabsContent>

              <TabsContent value={1} className="flex-1 overflow-y-auto">
                <div className="px-3 py-2 shrink-0">
                  <StockCombobox
                    onSelect={handleAddStock}
                    excludeSymbols={watchlist}
                  />
                </div>
                {watchlist.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 px-4 space-y-2">
                    <Eye className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-[10px] text-muted-foreground text-center">
                      No stocks on the watchlist yet. Add stocks this analyst should
                      prioritize during runs.
                    </p>
                  </div>
                ) : (
                  watchlist.map((symbol) => (
                    <WatchingRow
                      key={symbol}
                      symbol={symbol}
                      onRemove={handleRemoveStock}
                    />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
        {/* End Sidebar */}
      </div>

      {/* Config Sheet */}
      <AnalystConfigSheet
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
      />
    </>
  );
}
