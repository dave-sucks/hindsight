"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Briefcase, ExternalLink, FileText, Lock, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Signal, AnalystRouteInfo } from "./types";
import {
  relativeTime,
  JOB_LABELS,
  URGENCY_CONFIG,
  SENTIMENT_CONFIG,
} from "./types";

// ── Signal Feed ─────────────────────────────────────────────────────────────

interface SignalFeedProps {
  signals: Signal[];
  routes: AnalystRouteInfo[];
}

export function SignalFeed({ signals, routes }: SignalFeedProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [urgencyFilter, setUrgencyFilter] = useState("ALL");
  const [selected, setSelected] = useState<Signal | null>(null);

  const filtered = useMemo(() => {
    return signals.filter((s) => {
      if (typeFilter !== "ALL" && s.type !== typeFilter) return false;
      if (urgencyFilter !== "ALL" && s.urgency !== urgencyFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          s.headline.toLowerCase().includes(q) ||
          s.tickers.some((t) => t.toLowerCase().includes(q)) ||
          s.summary.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [signals, search, typeFilter, urgencyFilter]);

  const signalTypes = useMemo(
    () => [...new Set(signals.map((s) => s.type))].sort(),
    [signals]
  );

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search signals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={(val) => val && setTypeFilter(val)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Type</SelectItem>
              {signalTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={urgencyFilter} onValueChange={(val) => val && setUrgencyFilter(val)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Urgency</SelectItem>
              <SelectItem value="BREAKING">Breaking</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground tabular-nums">
            {filtered.length} signals
          </span>
        </div>

        {/* Signal list */}
        <div className="space-y-2">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No signals match your filters
            </p>
          )}
          {filtered.map((signal) => (
            <SignalRow
              key={signal.id}
              signal={signal}
              routes={routes}
              onClick={() => setSelected(signal)}
            />
          ))}
        </div>

        {/* Detail sheet */}
        <Sheet
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
        >
          <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
            {selected && (
              <SignalDetail signal={selected} routes={routes} />
            )}
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

// ── Signal Row ──────────────────────────────────────────────────────────────

function SignalRow({
  signal,
  routes,
  onClick,
}: {
  signal: Signal;
  routes: AnalystRouteInfo[];
  onClick: () => void;
}) {
  const urgency = URGENCY_CONFIG[signal.urgency] ?? URGENCY_CONFIG.LOW;
  const sentiment = SENTIMENT_CONFIG[signal.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL;

  return (
    <Card
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Urgency dot */}
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <span
              className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", urgency.dot)}
            />
          </TooltipTrigger>
          <TooltipContent side="left">{urgency.label} urgency</TooltipContent>
        </Tooltip>

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Headline */}
          <p className="text-sm font-medium leading-tight">{signal.headline}</p>

          {/* Summary */}
          <p className="text-xs text-muted-foreground line-clamp-2">
            {signal.summary}
          </p>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Tickers */}
            {signal.tickers.slice(0, 5).map((t) => (
              <Badge key={t} variant="secondary">
                ${t}
              </Badge>
            ))}
            {signal.tickers.length > 5 && (
              <span className="text-xs text-muted-foreground">
                +{signal.tickers.length - 5}
              </span>
            )}

            <Separator orientation="vertical" className="h-3" />

            {/* Sentiment */}
            <span className={cn("text-xs font-medium", sentiment.className)}>
              {sentiment.label}
            </span>

            <Separator orientation="vertical" className="h-3" />

            {/* Type + source */}
            <span className="text-xs text-muted-foreground">
              {signal.type}
            </span>
            {signal.sourceNames[0] && (
              <span className="text-xs text-muted-foreground">
                via {signal.sourceNames[0]}
              </span>
            )}

            {signal.artifactId && (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <FileText className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>Full article available</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Routing badges */}
          {routes.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {routes
                .filter((r) => r.totalRoutes > 0)
                .slice(0, 4)
                .map((r) => (
                  <Tooltip key={r.analystId}>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Badge variant="outline" className="text-[10px]">
                        {r.analystName}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      {r.totalRoutes} signals routed ({r.pending} pending, {r.read} read)
                    </TooltipContent>
                  </Tooltip>
                ))}
            </div>
          )}
        </div>

        {/* Time */}
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
          {relativeTime(signal.createdAt)}
        </span>
      </div>
    </Card>
  );
}

// ── Signal Detail Sheet ─────────────────────────────────────────────────────

function SignalDetail({
  signal,
  routes,
}: {
  signal: Signal;
  routes: AnalystRouteInfo[];
}) {
  const urgency = URGENCY_CONFIG[signal.urgency] ?? URGENCY_CONFIG.LOW;
  const sentiment = SENTIMENT_CONFIG[signal.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL;
  const jobLabel = JOB_LABELS[signal.batch?.jobType] ?? signal.batch?.jobType ?? "Unknown";

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", urgency.dot)} />
          <SheetTitle className="text-left">{signal.headline}</SheetTitle>
        </div>
      </SheetHeader>

      <div className="px-6 pb-6 space-y-5">
        {/* Summary */}
        <p className="text-sm text-muted-foreground">{signal.summary}</p>

        {/* Source / Job visual */}
        <SourceVisual signal={signal} jobLabel={jobLabel} />

        {/* Properties row */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{signal.type}</Badge>
            <Badge variant="secondary">
              <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", urgency.dot)} />
              {urgency.label}
            </Badge>
            <Badge variant="secondary">
              <span className={cn("mr-1", sentiment.className)}>{sentiment.label}</span>
            </Badge>
            <Badge variant="secondary">{signal.freshness}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Source Quality <span className="text-foreground tabular-nums">{signal.sourceQuality}/5</span></span>
            <span>Novelty <span className="text-foreground tabular-nums">{signal.noveltyScore}/100</span></span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Job <span className="text-foreground">{jobLabel}</span></span>
            <span>Time <span className="text-foreground tabular-nums">{relativeTime(signal.createdAt)}</span></span>
          </div>
        </div>

        <Separator />

        {/* Tickers */}
        {signal.tickers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tickers</span>
            {signal.tickers.map((t) => (
              <Badge key={t} variant="secondary">
                ${t}
              </Badge>
            ))}
          </div>
        )}

        {/* Themes */}
        {signal.themes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Themes</span>
            {signal.themes.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {/* Sectors */}
        {signal.sectors.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sectors</span>
            {signal.sectors.map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </div>
        )}

        {/* Routing */}
        {routes.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Routed to
              </p>
              <div className="space-y-1.5">
                {routes
                  .filter((r) => r.totalRoutes > 0)
                  .map((r) => (
                    <div
                      key={r.analystId}
                      className="flex items-center justify-between text-sm"
                    >
                      <span>{r.analystName}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                        <span>{r.high} high</span>
                        <span>{r.medium} med</span>
                        <span>{r.low} low</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}

        {/* Sources */}
        {signal.sourceUrls.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Sources
              </p>
              <div className="space-y-1.5">
                {signal.sourceUrls.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {signal.sourceNames[i] ?? new URL(url).hostname}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Artifact indicator */}
        {signal.artifactId && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            <span>Full article extracted (artifact {signal.artifactId.slice(0, 8)}...)</span>
          </div>
        )}
      </div>
    </>
  );
}

// ── Source Visual ────────────────────────────────────────────────────────────

function SourceVisual({
  signal,
  jobLabel,
}: {
  signal: Signal;
  jobLabel: string;
}) {
  const jobType = signal.batch?.jobType;

  if (jobType === "MARKET_SWEEP") {
    const query = signal.sourceNames[0] ?? "market scan";
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground truncate">{query}</span>
      </div>
    );
  }

  if (jobType === "SOURCE_PACK") {
    let domain = "source";
    try {
      if (signal.sourceUrls[0]) {
        domain = new URL(signal.sourceUrls[0]).hostname;
      }
    } catch {
      // keep default
    }
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground truncate">{domain}</span>
      </div>
    );
  }

  if (jobType === "PORTFOLIO_MONITOR") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Portfolio Monitor</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm text-muted-foreground">{jobLabel}</span>
    </div>
  );
}
