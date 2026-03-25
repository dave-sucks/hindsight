"use client";

import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  Check,
  Eye,
  Globe,
  Search,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { StockLogo } from "@/components/StockLogo";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalystConfigPanelProps {
  config: AgentConfigData;
  onConfirm: () => void;
  isCreating: boolean;
}

// ─── Direction helpers ────────────────────────────────────────────────────────

const directionMeta: Record<string, { icon: React.ReactNode; tip: string }> = {
  LONG: {
    icon: <ArrowUpRight className="h-3.5 w-3.5" />,
    tip: "Only takes long (buy) positions — bets on prices going up.",
  },
  SHORT: {
    icon: <ArrowDownRight className="h-3.5 w-3.5" />,
    tip: "Only takes short (sell) positions — bets on prices going down.",
  },
  BOTH: {
    icon: <ArrowLeftRight className="h-3.5 w-3.5" />,
    tip: "Can go long or short depending on the thesis.",
  },
};

// ─── Signal type tooltips ─────────────────────────────────────────────────────

const signalTips: Record<string, string> = {
  MOMENTUM: "Trades based on price momentum — stocks moving with strong trend continuation.",
  EARNINGS_BEAT: "Trades around earnings surprises — buys after positive EPS beats.",
  BREAKOUT: "Trades when price breaks through key support/resistance levels.",
  TECHNICAL_BREAKOUT: "Trades when price breaks through key support/resistance levels.",
  MEAN_REVERSION: "Buys oversold dips expecting price to revert to its moving average.",
  CATALYST: "Trades driven by specific events — FDA approvals, product launches, M&A.",
  OPTIONS_FLOW: "Follows unusual options activity as a signal for directional bets.",
  SECTOR_ROTATION: "Trades based on capital flowing between market sectors.",
  SENTIMENT: "Uses social/news sentiment analysis to gauge market direction.",
  VALUE: "Identifies undervalued stocks based on fundamental metrics.",
  GAP_FILL: "Trades overnight gaps expecting price to fill back to prior close.",
};

// ─── Quality dots ─────────────────────────────────────────────────────────────

function QualityDots({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className={`size-1.5 rounded-full ${
            i < score ? "bg-primary" : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Attention bar ────────────────────────────────────────────────────────────

function AttentionBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] tabular-nums font-medium">{value}%</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// ─── Gradient Orb ─────────────────────────────────────────────────────────────

function GradientOrb() {
  return (
    <div className="relative size-14 shrink-0">
      {/* Glow */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[var(--chart-1)] via-[var(--chart-2)] to-[var(--chart-3)] opacity-30 blur-md" />
      {/* Orb */}
      <div className="relative size-14 rounded-full bg-gradient-to-br from-[var(--chart-1)] via-[var(--chart-2)] to-[var(--chart-3)] opacity-80" />
      {/* Highlight */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/25 to-transparent" />
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function AnalystConfigPanel({
  config,
  onConfirm,
  isCreating,
}: AnalystConfigPanelProps) {
  const direction = config.directionBias ?? "BOTH";
  const sectors = config.sectors ?? [];
  const signalTypes = config.signalTypes ?? [];
  const watchlist = config.watchlist ?? [];
  const exclusionList = config.exclusionList ?? [];
  const holdDurations = config.holdDurations ?? [];
  const sources = config.sourcePackProposal?.sources ?? [];
  const queries = config.intelligenceQueries ?? [];
  const policy = config.intelligencePolicy;
  const dm = directionMeta[direction] ?? directionMeta.BOTH;

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* ── Header with gradient orb ────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center gap-3">
          <GradientOrb />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-base font-brand font-bold truncate leading-tight">
                {config.name || "Untitled Analyst"}
              </p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge
                        variant={
                          direction === "LONG"
                            ? "positive"
                            : direction === "SHORT"
                              ? "negative"
                              : "secondary"
                        }
                      >
                        {dm.icon}
                        {direction}
                      </Badge>
                    }
                  />
                  <TooltipContent side="bottom">{dm.tip}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {config.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {config.description}
              </p>
            )}
          </div>
        </div>
        {/* Meta strip */}
        <div className="mt-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 font-mono">
            <span>{direction}</span>
            <span className="opacity-30">&middot;</span>
            <span>{holdDurations.join("/") || "SWING"}</span>
            <span className="opacity-30">&middot;</span>
            <span className="tabular-nums">{config.minConfidence ?? 65}% MIN</span>
            <span className="opacity-30">&middot;</span>
            <span className="tabular-nums">${(config.maxPositionSize ?? 5000).toLocaleString()}</span>
            <span className="opacity-30">&middot;</span>
            <span>{config.minMarketCapTier ?? "LARGE"}+</span>
          </span>
        </div>
      </div>

      <Separator />

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-2 shrink-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Overview tab ───────────────────────────────────────── */}
        <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="px-4 py-3 space-y-3">
              {/* Strategy */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Strategy
                  </span>
                </div>
                <p className="text-sm font-light text-muted-foreground leading-relaxed">
                  {config.analystPrompt}
                </p>
              </div>

              {/* Signals with tooltips */}
              {signalTypes.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Signals
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <TooltipProvider>
                        {signalTypes.map((s) => {
                          const tip = signalTips[s] ?? `Trades based on ${s.replace(/_/g, " ").toLowerCase()} signals.`;
                          return (
                            <Tooltip key={s}>
                              <TooltipTrigger
                                render={
                                  <Badge variant="outline">
                                    <TrendingUp className="h-2.5 w-2.5" />
                                    {s.replace(/_/g, " ")}
                                  </Badge>
                                }
                              />
                              <TooltipContent side="bottom">{tip}</TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </TooltipProvider>
                    </div>
                  </div>
                </>
              )}

              {/* Sectors with tooltips */}
              {sectors.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Sectors
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <TooltipProvider>
                        {sectors.map((s) => (
                          <Tooltip key={s}>
                            <TooltipTrigger
                              render={
                                <Badge variant="outline">{s}</Badge>
                              }
                            />
                            <TooltipContent side="bottom">
                              Only researches stocks in the {s} sector.
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </TooltipProvider>
                    </div>
                  </div>
                </>
              )}

              {/* Watchlist — stock rows like source pack */}
              {watchlist.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Eye className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Watchlist
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 ml-auto tabular-nums">
                        {watchlist.length} {watchlist.length === 1 ? "stock" : "stocks"}
                      </span>
                    </div>
                    <div className="space-y-0">
                      {watchlist.map((t) => {
                        const symbol = typeof t === "string" ? t : t.symbol;
                        const reason = typeof t === "object" ? t.reason : undefined;
                        return (
                          <div
                            key={symbol}
                            className="flex items-center gap-2.5 py-1.5 border-b border-border/40 last:border-0"
                          >
                            <StockLogo ticker={symbol} size="sm" className="rounded-md" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium font-mono">{symbol}</span>
                              {reason && (
                                <p className="text-[10px] text-muted-foreground truncate">{reason}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Exclusion List — stock rows */}
              {exclusionList.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Ban className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Excluded
                      </span>
                    </div>
                    <div className="space-y-0">
                      {exclusionList.map((symbol) => (
                        <div
                          key={symbol}
                          className="flex items-center gap-2.5 py-1.5 border-b border-border/40 last:border-0"
                        >
                          <StockLogo ticker={symbol} size="sm" className="rounded-md" />
                          <span className="text-sm font-medium font-mono text-muted-foreground">{symbol}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Empty state */}
              {sectors.length === 0 &&
                signalTypes.length === 0 &&
                watchlist.length === 0 &&
                exclusionList.length === 0 && (
                  <div className="text-xs text-muted-foreground/40 py-6 text-center not-italic">
                    No configuration details yet.
                  </div>
                )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Intelligence tab ───────────────────────────────────── */}
        <TabsContent value="intelligence" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="px-4 py-3 space-y-3">
              {/* Source Pack */}
              {sources.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Globe className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Source Pack
                    </span>
                    {config.sourcePackProposal?.name && (
                      <span className="text-[10px] text-muted-foreground/60 ml-auto font-mono">
                        {config.sourcePackProposal.name}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0">
                    {sources.map((s) => (
                      <TooltipProvider key={s.domain}>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <div className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0 cursor-default">
                                <img
                                  src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=16`}
                                  alt=""
                                  width={14}
                                  height={14}
                                  className="size-3.5 rounded-sm shrink-0"
                                />
                                <span className="text-sm truncate flex-1">{s.name}</span>
                                <QualityDots score={s.qualityScore} />
                              </div>
                            }
                          />
                          <TooltipContent side="left">{s.reason}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                  </div>
                </div>
              )}

              {sources.length > 0 && queries.length > 0 && <Separator />}

              {/* Standing Queries */}
              {queries.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Search className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Standing Queries
                    </span>
                  </div>
                  <div className="space-y-1">
                    {queries.map((q, i) => (
                      <TooltipProvider key={i}>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <div className="flex items-start gap-2 cursor-default">
                                <span className="text-sm font-light text-foreground/80 flex-1">
                                  {q.query}
                                </span>
                                <Badge variant="secondary">{q.category}</Badge>
                              </div>
                            }
                          />
                          <TooltipContent side="left">{q.reason}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                  </div>
                </div>
              )}

              {(sources.length > 0 || queries.length > 0) && policy && (
                <Separator />
              )}

              {/* Policy */}
              {policy && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Attention Policy
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <AttentionBar
                      label="Holdings"
                      value={Math.round(policy.holdingsAttention * 100)}
                    />
                    <AttentionBar
                      label="Watchlist"
                      value={Math.round(policy.watchlistAttention * 100)}
                    />
                    <AttentionBar
                      label="Discovery"
                      value={Math.round(policy.discoveryAttention * 100)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-[10px]">
                    {policy.maxSignalsPerRun != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Signal budget</span>
                        <span className="tabular-nums font-medium">
                          {policy.maxSignalsPerRun}
                        </span>
                      </div>
                    )}
                    {policy.maxArtifactReads != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Artifact reads</span>
                        <span className="tabular-nums font-medium">
                          {policy.maxArtifactReads}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Live search</span>
                      <span className="font-medium">
                        {policy.allowLiveSearch ? "On" : "Off"}
                      </span>
                    </div>
                    {policy.allowLiveSearch && policy.liveSearchBudget != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Search budget</span>
                        <span className="tabular-nums font-medium">
                          {policy.liveSearchBudget}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {sources.length === 0 && queries.length === 0 && !policy && (
                <div className="text-xs text-muted-foreground/40 py-6 text-center not-italic">
                  No intelligence configuration yet.
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Config tab — flat key/value rows ─────────────────── */}
        <TabsContent value="config" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="px-4 py-3 space-y-2">
              <ConfigRow label="Direction" value={direction} />
              <ConfigRow
                label="Hold"
                value={holdDurations.join(", ") || "SWING"}
              />
              <ConfigRow
                label="Min Confidence"
                value={`${config.minConfidence ?? 65}%`}
                mono
              />
              <ConfigRow
                label="Max Position"
                value={`$${(config.maxPositionSize ?? 5000).toLocaleString()}`}
                mono
              />
              <ConfigRow
                label="Max Open"
                value={String(config.maxOpenPositions ?? 5)}
                mono
              />
              <ConfigRow
                label="Market Cap"
                value={`${config.minMarketCapTier ?? "LARGE"}+`}
              />
              {sectors.length > 0 && (
                <ConfigRow label="Sectors" value={sectors.join(", ")} />
              )}
              {signalTypes.length > 0 && (
                <ConfigRow
                  label="Signals"
                  value={signalTypes.map((s) => s.replace(/_/g, " ")).join(", ")}
                />
              )}
              {watchlist.length > 0 && (
                <ConfigRow
                  label="Watchlist"
                  value={watchlist
                    .map((t) => (typeof t === "string" ? t : t.symbol))
                    .join(", ")}
                  mono
                />
              )}
              {exclusionList.length > 0 && (
                <ConfigRow label="Excluded" value={exclusionList.join(", ")} mono />
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* ── Footer: Create button ─────────────────────────────── */}
      <div className="shrink-0 border-t px-4 py-3 flex">
        <Button
          onClick={onConfirm}
          disabled={isCreating}
          size="default"
          className="w-full"
        >
          <Check className="h-4 w-4 mr-2" />
          {isCreating ? "Creating..." : "Create Analyst"}
        </Button>
      </div>
    </div>
  );
}

// ─── Config row (flat key/value) ──────────────────────────────────────────────

function ConfigRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 border-b border-border/40 last:border-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
        {label}
      </span>
      <span
        className={`text-xs text-foreground/80 truncate text-right ${
          mono ? "font-mono tabular-nums" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
