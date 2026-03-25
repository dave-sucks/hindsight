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
import {
  BarChart3,
  CalendarDays,
  ExternalLink,
  FileText,
  Flame,
  Globe,
  Search,
  Sparkles,
} from "lucide-react";
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
  const tool = parseSearchTool(signal.searchTool);
  const context = parseSearchContext(signal.searchContext, signal.batch?.jobType);

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", urgency.dot)} />
          <SheetTitle className="text-left">{signal.headline}</SheetTitle>
        </div>
      </SheetHeader>

      <div className="px-6 pb-6 space-y-5">
        {/* ── Act 1: The Finding ──────────────────────────────────────── */}
        <p className="text-sm text-muted-foreground">{signal.summary}</p>

        {/* Classification badges */}
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

        {/* Tickers + Themes + Sectors inline */}
        {(signal.tickers.length > 0 || signal.themes.length > 0 || signal.sectors.length > 0) && (
          <div className="space-y-2">
            {signal.tickers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-1">Tickers</span>
                {signal.tickers.map((t) => (
                  <Badge key={t} variant="secondary">${t}</Badge>
                ))}
              </div>
            )}
            {signal.themes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-1">Themes</span>
                {signal.themes.map((t) => (
                  <Badge key={t} variant="outline">{t}</Badge>
                ))}
              </div>
            )}
            {signal.sectors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-1">Sectors</span>
                {signal.sectors.map((s) => (
                  <Badge key={s} variant="outline">{s}</Badge>
                ))}
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* ── Act 2: The Discovery Trail ──────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            How this was found
          </p>

          {/* Tool + Job */}
          <div className="rounded-lg border bg-muted/50 p-3 space-y-2.5">
            {/* Row 1: Tool used */}
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-background">
                <tool.icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">{tool.name}</span>
              <span className="text-xs text-muted-foreground">via {jobLabel}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {relativeTime(signal.createdAt)}
              </span>
            </div>

            {/* Row 2: The actual query */}
            {signal.searchQuery && (
              <div className="flex items-start gap-2">
                <Search className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-xs text-foreground font-mono break-all">
                  {signal.searchQuery}
                </p>
              </div>
            )}

            {/* Row 3: Why this search happened */}
            {context && (
              <p className="text-xs text-muted-foreground pl-5">
                {context}
              </p>
            )}
          </div>

          {/* Quality scores */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Source Quality <span className="text-foreground tabular-nums">{signal.sourceQuality}/5</span></span>
            <span>Novelty <span className="text-foreground tabular-nums">{signal.noveltyScore}/100</span></span>
          </div>
        </div>

        {/* ── Evidence Sources ────────────────────────────────────────── */}
        {signal.sourceUrls.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Evidence sources
              </p>
              <div className="space-y-1">
                {signal.sourceUrls.map((url, i) => {
                  let domain = url;
                  try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
                  const name = signal.sourceNames[i];
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 text-sm hover:bg-accent/50 transition-colors group"
                    >
                      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 min-w-0">
                        {name && (
                          <span className="text-foreground">{name}</span>
                        )}
                        <span className="text-xs text-muted-foreground ml-1 truncate">
                          {domain}
                        </span>
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Artifact (full extraction) */}
        {signal.artifactId && (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
            <Flame className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Full article extracted via Firecrawl
            </span>
          </div>
        )}

        {/* ── Act 3: The Routing ──────────────────────────────────────── */}
        {routes.length > 0 && routes.some((r) => r.totalRoutes > 0) && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
      </div>
    </>
  );
}

// ── Provenance Helpers ──────────────────────────────────────────────────────

const TOOL_CONFIG: Record<string, { name: string; icon: typeof Sparkles }> = {
  PERPLEXITY_SONAR: { name: "Perplexity Sonar", icon: Sparkles },
  FMP: { name: "Financial Modeling Prep", icon: BarChart3 },
  FINNHUB: { name: "Finnhub", icon: CalendarDays },
  FIRECRAWL: { name: "Firecrawl", icon: Flame },
};

function parseSearchTool(tool: string | null): { name: string; icon: typeof Sparkles } {
  if (tool && TOOL_CONFIG[tool]) return TOOL_CONFIG[tool];
  return { name: "Unknown source", icon: Globe };
}

function parseSearchContext(context: string | null, jobType?: string): string | null {
  if (!context) {
    // Fallback: explain based on job type alone
    if (jobType === "PORTFOLIO_MONITOR") return "Searched because this ticker is in an open position or on a watchlist";
    if (jobType === "MARKET_SWEEP") return "Part of the daily intelligence sweep using your configured queries";
    if (jobType === "SOURCE_PACK") return "Crawled from a monitored source in your config";
    return null;
  }

  // Parse structured context strings
  if (context.startsWith("ticker:")) {
    const ticker = context.replace("ticker:", "");
    return `Searched because ${ticker} is in an open position or on a watchlist`;
  }

  if (context.startsWith("query:")) {
    const parts = context.split(":");
    const category = parts[1] ?? "custom";
    return `Matched intelligence query (${category})`;
  }

  if (context.startsWith("source_pack:")) {
    const parts = context.replace("source_pack:", "").split(":");
    const packName = parts[0] ?? "Unknown";
    const domains = parts[1]?.split(",").slice(0, 3).join(", ") ?? "";
    return domains
      ? `Source pack "${packName}" — monitoring ${domains}`
      : `Source pack "${packName}"`;
  }

  if (context.startsWith("market_movers:")) {
    const label = context.replace("market_movers:", "");
    return `FMP market movers: ${label}`;
  }

  if (context === "earnings_calendar") {
    return "Finnhub earnings calendar (next 7 days)";
  }

  return context;
}
