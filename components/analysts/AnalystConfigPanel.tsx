"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Check,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { StockLogo } from "@/components/StockLogo";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

const Silk = dynamic(() => import("@/components/Silk"), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalystConfigPanelProps {
  config: AgentConfigData;
  onConfirm: () => void;
  isCreating: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
}

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

// ─── Panel ────────────────────────────────────────────────────────────────────

export function AnalystConfigPanel({
  config,
  onConfirm,
  isCreating,
  confirmLabel = "Create Analyst",
  confirmingLabel = "Creating...",
}: AnalystConfigPanelProps) {
  const direction = config.directionBias ?? "BOTH";
  const sectors = config.sectors ?? [];
  const signalTypes = config.signalTypes ?? [];
  const watchlist = config.watchlist ?? [];
  const exclusionList = config.exclusionList ?? [];
  const holdDurations = config.holdDurations ?? [];
  const sources = config.domainMonitorProposal?.sources ?? [];
  const queries = config.intelligenceQueries ?? [];
  const policy = config.intelligencePolicy;

  // Silk background — plays on mount and when applying changes
  const [silkActive, setSilkActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSilkActive(false), 2000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (isCreating) setSilkActive(true);
  }, [isCreating]);

  return (
    <div className="flex flex-col h-full rounded-xl border bg-background shadow-2xl overflow-hidden relative">
      {/* Full-panel Silk intro */}
      <div
        className="absolute inset-0 z-[5] transition-opacity duration-1000 ease-out"
        style={{ opacity: silkActive ? 1 : 0, pointerEvents: "none" }}
      >
        <Silk speed={5} scale={0.85} color="#919191" noiseIntensity={1.5} rotation={0} />
      </div>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="relative z-[6] shrink-0 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div style={{ width: 48, height: 48, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}>
            <Silk speed={5} scale={0.85} color="#919191" noiseIntensity={1.5} rotation={0} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-brand font-bold truncate leading-tight">
              {config.name || "Untitled Analyst"}
            </p>
            {config.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {config.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <Tabs defaultValue="overview" className="relative z-[6] flex-1 flex flex-col min-h-0">
        <div className="px-4 pt-1 shrink-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Overview tab ───────────────────────────────────────── */}
        <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div>
              {/* Strategy */}
              {config.analystPrompt && (
                <div className="p-3 border-b">
                  <p className="text-sm font-medium mb-1">Strategy</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {config.analystPrompt}
                  </p>
                </div>
              )}

              {/* Excluded */}
              {exclusionList.length > 0 && (
                <div className="p-3 border-b">
                  <p className="text-sm font-medium mb-1.5">Excluded</p>
                  {exclusionList.map((symbol) => (
                    <div
                      key={symbol}
                      className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0"
                    >
                      <StockLogo ticker={symbol} size="sm" />
                      <span className="font-mono text-[11px] text-muted-foreground">{symbol}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {exclusionList.length === 0 && !config.analystPrompt && (
                <div className="text-xs text-muted-foreground/40 py-6 text-center">
                  No configuration details yet.
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Intelligence tab ───────────────────────────────────── */}
        <TabsContent value="intelligence" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div>
              {/* Watchlist */}
              {watchlist.length > 0 && (
                <div className="p-3 border-b">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-medium">Watchlist</p>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {watchlist.length}
                    </span>
                  </div>
                  {watchlist.map((t) => {
                    const symbol = typeof t === "string" ? t : t.symbol;
                    const reason = typeof t === "object" ? t.reason : undefined;
                    return (
                      <div
                        key={symbol}
                        className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0"
                      >
                        <StockLogo ticker={symbol} size="sm" />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-[11px] font-medium">{symbol}</span>
                          {reason && (
                            <p className="text-[10px] text-muted-foreground truncate">{reason}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Domain Monitors */}
              {sources.length > 0 && (
                <div className="p-3 border-b">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-medium">Sources</p>
                    {config.domainMonitorProposal?.name && (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {config.domainMonitorProposal.name}
                      </span>
                    )}
                  </div>
                  <TooltipProvider>
                    {sources.map((s) => (
                      <Tooltip key={s.domain}>
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
                              <span className="text-[11px] text-muted-foreground font-mono">{s.domain}</span>
                            </div>
                          }
                        />
                        <TooltipContent side="left">{s.reason}</TooltipContent>
                      </Tooltip>
                    ))}
                  </TooltipProvider>
                </div>
              )}

              {/* Search Monitors */}
              {queries.length > 0 && (
                <div className="p-3 border-b">
                  <p className="text-sm font-medium mb-1.5">Search Queries</p>
                  <TooltipProvider>
                    {queries.map((q, i) => (
                      <Tooltip key={i}>
                        <TooltipTrigger
                          render={
                            <div className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0 cursor-default">
                              <span className="text-sm text-muted-foreground flex-1">{q.query}</span>
                              <span className="text-[11px] text-muted-foreground">{q.category}</span>
                            </div>
                          }
                        />
                        <TooltipContent side="left">{q.reason}</TooltipContent>
                      </Tooltip>
                    ))}
                  </TooltipProvider>
                </div>
              )}

              {/* Attention Policy */}
              {policy && (
                <div className="p-3 border-b">
                  <p className="text-sm font-medium mb-1.5">Attention Policy</p>
                  <div className="space-y-1">
                    <PolicyRow label="Holdings" value={Math.round(policy.holdingsAttention * 100)} />
                    <PolicyRow label="Watchlist" value={Math.round(policy.watchlistAttention * 100)} />
                    <PolicyRow label="Discovery" value={Math.round(policy.discoveryAttention * 100)} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2">
                    {policy.maxSignalsPerRun != null && (
                      <PolicyKV label="Signal budget" value={String(policy.maxSignalsPerRun)} />
                    )}
                    {policy.maxArtifactReads != null && (
                      <PolicyKV label="Artifact reads" value={String(policy.maxArtifactReads)} />
                    )}
                    <PolicyKV label="Live search" value={policy.allowLiveSearch ? "On" : "Off"} />
                    {policy.allowLiveSearch && policy.liveSearchBudget != null && (
                      <PolicyKV label="Search budget" value={String(policy.liveSearchBudget)} />
                    )}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {watchlist.length === 0 && sources.length === 0 && queries.length === 0 && !policy && (
                <div className="text-xs text-muted-foreground/40 py-6 text-center">
                  No intelligence configuration yet.
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Config tab ─────────────────────────────────────────── */}
        <TabsContent value="config" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div>
              <div className="p-3 border-b">
                <ConfigRow label="Direction" value={direction} />
                <ConfigRow label="Hold" value={holdDurations.join(", ") || "SWING"} />
                <ConfigRow label="Min Confidence" value={`${config.minConfidence ?? 65}%`} mono />
                <ConfigRow label="Max Position" value={`$${(config.maxPositionSize ?? 5000).toLocaleString()}`} mono />
                <ConfigRow label="Max Open" value={String(config.maxOpenPositions ?? 5)} mono />
                <ConfigRow label="Market Cap" value={`${config.minMarketCapTier ?? "LARGE"}+`} />
                {exclusionList.length > 0 && (
                  <ConfigRow label="Excluded" value={exclusionList.join(", ")} mono />
                )}
              </div>

              {/* Signals */}
              {signalTypes.length > 0 && (
                <div className="p-3 border-b">
                  <p className="text-sm font-medium mb-1.5">Signals</p>
                  <div className="flex flex-wrap gap-1.5">
                    <TooltipProvider>
                      {signalTypes.map((s) => {
                        const tip = signalTips[s] ?? `Trades based on ${s.replace(/_/g, " ").toLowerCase()} signals.`;
                        return (
                          <Tooltip key={s}>
                            <TooltipTrigger
                              render={
                                <Badge variant="outline">
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
              )}

              {/* Sectors */}
              {sectors.length > 0 && (
                <div className="p-3">
                  <p className="text-sm font-medium mb-1.5">Sectors</p>
                  <div className="flex flex-wrap gap-1.5">
                    <TooltipProvider>
                      {sectors.map((s) => (
                        <Tooltip key={s}>
                          <TooltipTrigger
                            render={<Badge variant="outline">{s}</Badge>}
                          />
                          <TooltipContent side="bottom">
                            Only researches stocks in the {s} sector.
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </TooltipProvider>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="relative z-[6] shrink-0 border-t px-4 py-3 flex">
        <Button
          onClick={onConfirm}
          disabled={isCreating}
          size="default"
          className="w-full"
        >
          <Check className="h-4 w-4 mr-2" />
          {isCreating ? confirmingLabel : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

// ─── Shared rows ─────────────────────────────────────────────────────────────

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
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm text-foreground truncate text-right ${mono ? "font-mono tabular-nums" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function PolicyRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums font-medium">{value}%</span>
    </div>
  );
}

function PolicyKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[11px] tabular-nums font-medium">{value}</span>
    </div>
  );
}
