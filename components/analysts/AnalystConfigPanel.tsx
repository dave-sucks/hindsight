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
      <div className="relative overflow-hidden px-4 pt-4 pb-3 shrink-0">
        {/* Gradient blob */}
        <div className="analyst-gradient-blob" />
        {/* Content overlay */}
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-brand font-bold truncate leading-tight">
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
          {/* Meta strip — thesis-card style */}
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

              {/* Sectors */}
              {sectors.length > 0 && (
                <>
                  <Separator />
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
                </>
              )}

              {/* Signal Types */}
              {signalTypes.length > 0 && (
                <>
                  <Separator />
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
                </>
              )}

              {/* Watchlist */}
              {watchlist.length > 0 && (
                <>
                  <Separator />
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
                            <span className="font-mono">{symbol}</span>
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Exclusion List */}
              {exclusionList.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Excluded
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {exclusionList.map((t) => (
                        <Badge key={t} variant="outline">
                          <Ban className="h-2.5 w-2.5" />
                          <span className="font-mono">{t}</span>
                        </Badge>
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
                  <div className="space-y-1">
                    {sources.map((s) => (
                      <div
                        key={s.domain}
                        className="flex items-center gap-2 py-0.5"
                      >
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
                      <div
                        key={i}
                        className="flex items-start gap-2"
                      >
                        <span className="text-sm font-light text-foreground/80 flex-1">
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

        {/* ── Config tab — raw JSON-like key/values ────────────── */}
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
                <ConfigRow
                  label="Sectors"
                  value={sectors.join(", ")}
                />
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
                <ConfigRow
                  label="Excluded"
                  value={exclusionList.join(", ")}
                  mono
                />
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

// ─── Config row (Rox-style key/value) ─────────────────────────────────────────

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
