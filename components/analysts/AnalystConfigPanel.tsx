"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Check, Globe, Search, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";

const Silk = dynamic(() => import("@/components/Silk"), { ssr: false });
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/info-row";
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

interface AnalystConfigPanelProps {
  config: AgentConfigData;
  onConfirm: () => void;
  isCreating: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
}

export function AnalystConfigPanel({
  config,
  onConfirm,
  isCreating,
  confirmLabel = "Create Analyst",
  confirmingLabel = "Creating...",
}: AnalystConfigPanelProps) {
  // Silk background — plays on mount and when applying changes
  const [silkActive, setSilkActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSilkActive(false), 2000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (isCreating) setSilkActive(true);
  }, [isCreating]);

  const direction = config.directionBias ?? "BOTH";
  const sectors = config.sectors ?? [];
  const signalTypes = config.signalTypes ?? [];
  const watchlist = config.watchlist ?? [];
  const exclusionList = config.exclusionList ?? [];
  const holdDurations = config.holdDurations ?? [];
  const sources = config.domainMonitorProposal?.sources ?? [];
  const queries = config.intelligenceQueries ?? [];
  const policy = config.intelligencePolicy;

  return (
    <div className="flex flex-col h-full rounded-xl border bg-background shadow-2xl overflow-hidden relative">
      {/* Full-panel Silk intro */}
      <div
        className="absolute inset-0 z-[5] transition-opacity duration-1000 ease-out pointer-events-none"
        style={{ opacity: silkActive ? 1 : 0 }}
      >
        <Silk speed={5} scale={0.85} color="#919191" noiseIntensity={1.5} rotation={0} />
      </div>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="relative z-[6] shrink-0 px-4 pt-4 pb-3 border-b">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-full overflow-hidden shrink-0">
            <Silk speed={5} scale={0.85} color="#919191" noiseIntensity={1.5} rotation={0} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate leading-tight">
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
              {config.analystPrompt && (
                <div className="p-3 border-b">
                  <p className="text-sm font-medium mb-1">Strategy</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {config.analystPrompt}
                  </p>
                </div>
              )}

              {exclusionList.length > 0 && (
                <div className="p-3 border-b">
                  <p className="text-sm font-medium mb-1.5">Excluded</p>
                  <div className="flex flex-col gap-1">
                    {exclusionList.map((symbol) => (
                      <div
                        key={symbol}
                        className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0"
                      >
                        <StockLogo ticker={symbol} size="sm" />
                        <span className="font-mono tabular-nums text-muted-foreground">{symbol}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
            <TooltipProvider>
              <div>
                {/* Watchlist */}
                {watchlist.length > 0 && (
                  <div className="p-3 border-b">
                    <p className="text-sm font-medium mb-1.5">Watchlist</p>
                    <div className="flex flex-col gap-1">
                      {watchlist.map((t) => {
                        const symbol = typeof t === "string" ? t : t.symbol;
                        const reason = typeof t === "object" ? t.reason : undefined;
                        return (
                          <div
                            key={symbol}
                            className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0"
                          >
                            <StockLogo ticker={symbol} size="sm" />
                            <div className="flex-1 min-w-0">
                              <span className="font-mono tabular-nums font-medium">{symbol}</span>
                              {reason && (
                                <p className="text-xs text-muted-foreground truncate">{reason}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sources */}
                {sources.length > 0 && (
                  <div className="p-3 border-b">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-sm font-medium">Sources</p>
                      <Tooltip>
                        <TooltipTrigger render={<span className="cursor-help" />}>
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Websites monitored daily for new articles. Perplexity Sonar searches each domain, then Firecrawl extracts full article text for the agent to read.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex flex-col gap-1">
                      {sources.map((s) => (
                        <Tooltip key={s.domain}>
                          <TooltipTrigger
                            render={
                              <div className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default">
                                <img
                                  src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=16`}
                                  alt=""
                                  width={14}
                                  height={14}
                                  className="size-3.5 rounded-sm shrink-0"
                                />
                                <span className="truncate flex-1">{s.name}</span>
                              </div>
                            }
                          />
                          <TooltipContent side="left">{s.reason}</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search Queries */}
                {queries.length > 0 && (
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-sm font-medium">Search Queries</p>
                      <Tooltip>
                        <TooltipTrigger render={<span className="cursor-help" />}>
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Perplexity Sonar runs these queries daily before the agent wakes up. Results become findings that get routed to the analyst based on relevance.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex flex-col gap-1">
                      {queries.map((q, i) => (
                        <Tooltip key={i}>
                          <TooltipTrigger
                            render={
                              <div className="flex items-center gap-2 text-sm border-b border-border pb-1 last:border-0 cursor-default">
                                <span className="flex-1">{q.query}</span>
                              </div>
                            }
                          />
                          <TooltipContent side="left">{q.reason}</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                )}

                {watchlist.length === 0 && sources.length === 0 && queries.length === 0 && (
                  <div className="text-xs text-muted-foreground/40 py-6 text-center">
                    No intelligence configuration yet.
                  </div>
                )}
              </div>
            </TooltipProvider>
          </ScrollArea>
        </TabsContent>

        {/* ── Config tab ─────────────────────────────────────────── */}
        <TabsContent value="config" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="p-3 flex flex-col gap-1">
              <InfoRow label="Direction" value={direction} />
              <InfoRow label="Hold" value={holdDurations.join(", ") || "Swing"} />
              <InfoRow label="Min Confidence" value={`${config.minConfidence ?? 65}%`} mono />
              <InfoRow label="Max Position" value={`$${(config.maxPositionSize ?? 5000).toLocaleString()}`} mono />
              <InfoRow label="Max Open" value={String(config.maxOpenPositions ?? 5)} mono />
              <InfoRow label="Market Cap" value={`${config.minMarketCapTier ?? "LARGE"}+`} />

              {/* Attention policy — inline */}
              {policy && (
                <>
                  <InfoRow label="Holdings attention" value={`${Math.round(policy.holdingsAttention * 100)}%`} mono />
                  <InfoRow label="Watchlist attention" value={`${Math.round(policy.watchlistAttention * 100)}%`} mono />
                  <InfoRow label="Discovery attention" value={`${Math.round(policy.discoveryAttention * 100)}%`} mono />
                  {policy.maxSignalsPerRun != null && (
                    <InfoRow label="Signal budget" value={String(policy.maxSignalsPerRun)} mono />
                  )}
                  <InfoRow label="Live search" value={policy.allowLiveSearch ? "On" : "Off"} />
                </>
              )}

              {sectors.length > 0 && (
                <InfoRow label="Sectors">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {sectors.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s.charAt(0) + s.slice(1).toLowerCase()}
                      </Badge>
                    ))}
                  </div>
                </InfoRow>
              )}

              {signalTypes.length > 0 && (
                <InfoRow label="Signals">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {signalTypes.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                </InfoRow>
              )}

              {exclusionList.length > 0 && (
                <InfoRow label="Excluded" value={exclusionList.join(", ")} mono border={false} />
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-t px-4 py-3 flex">
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
