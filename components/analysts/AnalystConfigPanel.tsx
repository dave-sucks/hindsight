"use client";

import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Ban,
  Check,
  Clock,
  DollarSign,
  Eye,
  Globe,
  Search,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalystConfigPanelProps {
  config: AgentConfigData;
  onConfirm: () => void;
  isCreating: boolean;
}

// ─── Direction helpers ────────────────────────────────────────────────────────

const directionIcon = {
  LONG: <ArrowUpRight className="h-3.5 w-3.5" />,
  SHORT: <ArrowDownRight className="h-3.5 w-3.5" />,
  BOTH: <ArrowLeftRight className="h-3.5 w-3.5" />,
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

// ─── Stat cell ────────────────────────────────────────────────────────────────

function StatCell({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="text-sm tabular-nums font-semibold truncate">{value}</p>
    </div>
  );
}

// ─── Attention bar ────────────────────────────────────────────────────────────

function AttentionBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs tabular-nums font-medium">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
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

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* ── Animated gradient header ──────────────────────────────── */}
      <div className="relative overflow-hidden px-5 pt-5 pb-4 shrink-0">
        {/* Gradient blob */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="analyst-gradient-blob absolute -inset-4 opacity-30 blur-2xl" />
        </div>
        {/* Content overlay */}
        <div className="relative">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-lg font-semibold truncate">
                {config.name || "Untitled Analyst"}
              </p>
              {config.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {config.description}
                </p>
              )}
            </div>
            <Badge
              variant={
                direction === "LONG"
                  ? "positive"
                  : direction === "SHORT"
                    ? "negative"
                    : "secondary"
              }
            >
              {directionIcon[direction]}
              {direction}
            </Badge>
          </div>
        </div>
      </div>

      <Separator />

      {/* ── Tabs ──────────────────────────────────────────────────── */}
      <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
        <div className="px-5 pt-3 shrink-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Overview tab ───────────────────────────────────────── */}
        <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="px-5 py-4 space-y-4">
              {/* Strategy */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Strategy
                  </span>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {config.analystPrompt}
                </p>
              </div>

              <Separator />

              {/* Stats grid */}
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Parameters
                </span>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <StatCell
                    icon={Shield}
                    label="Confidence"
                    value={`${config.minConfidence ?? 65}%`}
                  />
                  <StatCell
                    icon={DollarSign}
                    label="Position"
                    value={`$${(config.maxPositionSize ?? 5000).toLocaleString()}`}
                  />
                  <StatCell
                    icon={Target}
                    label="Max Open"
                    value={String(config.maxOpenPositions ?? 5)}
                  />
                  <StatCell
                    icon={Clock}
                    label="Duration"
                    value={holdDurations.join(", ") || "SWING"}
                  />
                  <StatCell
                    icon={BarChart3}
                    label="Market Cap"
                    value={`${config.minMarketCapTier ?? "LARGE"}+`}
                  />
                  <StatCell
                    icon={ArrowLeftRight}
                    label="Direction"
                    value={direction}
                  />
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Intelligence tab ───────────────────────────────────── */}
        <TabsContent value="intelligence" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="px-5 py-4 space-y-4">
              {/* Source Pack */}
              {sources.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Globe className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Source Pack
                    </span>
                    {config.sourcePackProposal?.name && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {config.sourcePackProposal.name}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {sources.map((s) => (
                      <div
                        key={s.domain}
                        className="flex items-center gap-2 text-sm"
                      >
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=16`}
                          alt=""
                          width={14}
                          height={14}
                          className="size-3.5 rounded-sm shrink-0"
                        />
                        <span className="truncate flex-1">{s.name}</span>
                        <QualityDots score={s.qualityScore} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sources.length > 0 && queries.length > 0 && <Separator />}

              {/* Standing Queries */}
              {queries.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Search className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Standing Queries
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {queries.map((q, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-sm"
                      >
                        <span className="flex-1 text-foreground/80">
                          {q.query}
                        </span>
                        <Badge variant="secondary">
                          {q.category}
                        </Badge>
                      </div>
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
                  <div className="flex items-center gap-1.5 mb-2">
                    <Zap className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Attention Policy
                    </span>
                  </div>
                  <div className="space-y-2">
                    <AttentionBar
                      label="Holdings"
                      value={policy.holdingsAttention}
                    />
                    <AttentionBar
                      label="Watchlist"
                      value={policy.watchlistAttention}
                    />
                    <AttentionBar
                      label="Discovery"
                      value={policy.discoveryAttention}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs">
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
                <div className="text-sm text-muted-foreground py-6 text-center">
                  No intelligence configuration yet.
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Config tab ─────────────────────────────────────────── */}
        <TabsContent value="config" className="flex-1 min-h-0 mt-0">
          <ScrollArea className="h-full">
            <div className="px-5 py-4 space-y-4">
              {/* Sectors */}
              {sectors.length > 0 && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Sectors
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {sectors.map((s) => (
                      <Badge key={s} variant="outline">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Signal Types */}
              {signalTypes.length > 0 && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Signals
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {signalTypes.map((s) => (
                      <Badge key={s} variant="outline">
                        <TrendingUp className="h-2.5 w-2.5" />
                        {s.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Watchlist */}
              {watchlist.length > 0 && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Watchlist
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {watchlist.map((t) => {
                      const symbol = typeof t === "string" ? t : t.symbol;
                      return (
                        <Badge key={symbol} variant="outline">
                          <Eye className="h-2.5 w-2.5" />
                          {symbol}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Exclusion List */}
              {exclusionList.length > 0 && (
                <div>
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Excluded
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {exclusionList.map((t) => (
                      <Badge key={t} variant="outline">
                        <Ban className="h-2.5 w-2.5" />
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {sectors.length === 0 &&
                signalTypes.length === 0 &&
                watchlist.length === 0 &&
                exclusionList.length === 0 && (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    No configuration details yet.
                  </div>
                )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* ── Footer: Create button ─────────────────────────────── */}
      <div className="shrink-0 border-t px-5 py-4 flex">
        <Button
          onClick={onConfirm}
          disabled={isCreating}
          size="default"
        >
          <Check className="h-4 w-4 mr-2" />
          {isCreating ? "Creating..." : "Create Analyst"}
        </Button>
      </div>
    </div>
  );
}
