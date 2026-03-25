"use client";

import { useState, useMemo, useCallback, memo } from "react";
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
  Briefcase,
  CalendarDays,
  ExternalLink,
  FileText,
  Flame,
  Globe,
  Lock,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Signal, AnalystRouteInfo } from "./types";
import {
  relativeTime,
  JOB_LABELS,
  URGENCY_CONFIG,
  SENTIMENT_CONFIG,
} from "./types";
import { PerplexityLogo, FirecrawlLogo } from "./icons";

type Icon = React.ComponentType<{ className?: string }>;

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

  const handleSelect = useCallback((signal: Signal) => {
    setSelected(signal);
  }, []);

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
              onSelect={handleSelect}
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

const SignalRow = memo(function SignalRow({
  signal,
  routes,
  onSelect,
}: {
  signal: Signal;
  routes: AnalystRouteInfo[];
  onSelect: (signal: Signal) => void;
}) {
  const urgency = URGENCY_CONFIG[signal.urgency] ?? URGENCY_CONFIG.LOW;
  const sentiment = SENTIMENT_CONFIG[signal.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL;

  return (
    <Card
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelect(signal)}
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
            <span className="text-xs text-muted-foreground">
              {signal.sourceNames[0]
                ? `via ${signal.sourceNames[0]}`
                : `via ${JOB_LABELS[signal.batch?.jobType] ?? "Intelligence"}`}
            </span>

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
});

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
  const discovery = inferDiscovery(signal);

  return (
    <>
      <SheetHeader className="space-y-4">
        {/* ── Discovery header (matches config popover style) ─────── */}
        <DiscoveryHeader discovery={discovery} signal={signal} />

        {/* Title + summary */}
        <div className="space-y-2">
          <SheetTitle className="text-left leading-tight">
            {signal.headline}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">{signal.summary}</p>
        </div>
      </SheetHeader>

      <div className="px-6 pb-6 space-y-5">
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

        {/* Tickers + Themes + Sectors */}
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

        {/* ── How it works ────────────────────────────────────────────── */}
        <div className="text-xs space-y-2">
          <div className="flex items-center gap-2">
            <discovery.toolIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground">{discovery.toolName}</span>
            <span className="text-muted-foreground">via {discovery.jobLabel}</span>
            <span className="ml-auto text-muted-foreground tabular-nums">
              {relativeTime(signal.createdAt)}
            </span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {discovery.explanation}
          </p>
        </div>

        {/* Quality scores */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Source Quality <span className="text-foreground tabular-nums">{signal.sourceQuality}/5</span></span>
          <span>Novelty <span className="text-foreground tabular-nums">{signal.noveltyScore}/100</span></span>
        </div>

        {/* ── Evidence Sources ────────────────────────────────────────── */}
        {signal.sourceUrls.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sources
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

        {/* Artifact */}
        {signal.artifactId && (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
            <Flame className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Full article extracted via Firecrawl
            </span>
          </div>
        )}

        {/* ── Routing ─────────────────────────────────────────────────── */}
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

// ── Discovery Header ────────────────────────────────────────────────────────
// Visual header matching the config popover style — search bar, domain bar,
// ticker bar, or API endpoint depending on how the signal was discovered.

interface Discovery {
  type: "search" | "portfolio" | "domain" | "api";
  /** What to show in the visual bar */
  visual: string;
  /** Resolved tool name */
  toolName: string;
  toolIcon: Icon;
  jobLabel: string;
  explanation: string;
  /** For domain type: the source/publication name */
  sourceName?: string;
}

function inferDiscovery(signal: Signal): Discovery {
  const jobType = signal.batch?.jobType;
  const jobLabel = JOB_LABELS[jobType] ?? jobType ?? "Intelligence";

  // If we have provenance data (searchTool is populated), use it directly
  if (signal.searchTool) {
    const toolCfg = TOOL_CONFIG[signal.searchTool];
    const toolName = toolCfg?.name ?? signal.searchTool;
    const toolIcon = toolCfg?.icon ?? Globe;

    if (signal.searchContext?.startsWith("ticker:")) {
      const ticker = signal.searchContext.replace("ticker:", "");
      return {
        type: "portfolio",
        visual: `$${ticker}`,
        toolName,
        toolIcon,
        jobLabel,
        explanation: `Sent "${signal.searchQuery ?? `${ticker} stock news`}" to Perplexity Sonar because ${ticker} is in an open position or on a watchlist. Each result becomes a signal.`,
      };
    }

    if (signal.searchContext?.startsWith("source_pack:")) {
      const parts = signal.searchContext.replace("source_pack:", "").split(":");
      const packName = parts[0] ?? "Sources";
      const domains = parts[1]?.split(",").slice(0, 3) ?? [];
      return {
        type: "domain",
        visual: domains[0] ?? packName,
        sourceName: packName,
        toolName,
        toolIcon,
        jobLabel,
        explanation: `Searched ${domains.length > 0 ? domains.join(", ") : "monitored domains"} via Perplexity Sonar (domain-filtered). High-value pages get full extraction via Firecrawl.`,
      };
    }

    if (signal.searchContext?.startsWith("market_movers:")) {
      const label = signal.searchContext.replace("market_movers:", "");
      return {
        type: "api",
        visual: signal.searchQuery ?? `/stock_market/${label}`,
        toolName,
        toolIcon,
        jobLabel,
        explanation: `Called FMP market movers API for ${label}. Each of the top 10 results becomes a separate signal with price change data.`,
      };
    }

    if (signal.searchContext === "earnings_calendar") {
      return {
        type: "api",
        visual: signal.searchQuery ?? "/calendar/earnings",
        toolName,
        toolIcon,
        jobLabel,
        explanation: "Called Finnhub earnings calendar API for the next 7 days. Each company with upcoming earnings becomes a signal.",
      };
    }

    // Generic search query
    return {
      type: "search",
      visual: signal.searchQuery ?? "Intelligence search",
      toolName,
      toolIcon,
      jobLabel,
      explanation: `Ran this query through Perplexity Sonar web search. Each distinct finding becomes a signal with extracted tickers, sentiment, and source URLs.`,
    };
  }

  // ── Fallback: infer from batch jobType + signal data ─────────────────
  // This handles all existing signals that were created before provenance
  // columns were added to the database.

  if (jobType === "PORTFOLIO_MONITOR") {
    const ticker = signal.tickers[0] ?? "positions";
    return {
      type: "portfolio",
      visual: signal.tickers.length === 1 ? `$${ticker}` : signal.tickers.slice(0, 3).map(t => `$${t}`).join(", "),
      toolName: "Perplexity Sonar",
      toolIcon: PerplexityLogo,
      jobLabel,
      explanation: `Searched "${ticker} stock news developments catalysts today" via Perplexity Sonar because this ticker is in an open position or on a watchlist. Each result becomes a signal.`,
    };
  }

  if (jobType === "SOURCE_PACK") {
    const domain = extractDomainFromUrls(signal.sourceUrls);
    return {
      type: "domain",
      visual: domain ?? "Monitored sources",
      sourceName: signal.sourceNames[0] ?? undefined,
      toolName: "Perplexity Sonar",
      toolIcon: PerplexityLogo,
      jobLabel,
      explanation: "Searched monitored domains via Perplexity Sonar (domain-filtered search). High-value pages get full text extraction via Firecrawl.",
    };
  }

  if (jobType === "MARKET_SWEEP") {
    // FMP signals have sourceNames=["FMP"] or ["Finnhub"], Sonar signals have publication names
    if (signal.sourceNames.includes("FMP")) {
      return {
        type: "api",
        visual: "/stock_market/movers",
        toolName: "Financial Modeling Prep",
        toolIcon: BarChart3,
        jobLabel,
        explanation: "Called FMP market movers API (gainers, losers, most active). Each of the top 10 results per category becomes a signal.",
      };
    }
    if (signal.sourceNames.includes("Finnhub")) {
      return {
        type: "api",
        visual: "/calendar/earnings",
        toolName: "Finnhub",
        toolIcon: CalendarDays,
        jobLabel,
        explanation: "Called Finnhub earnings calendar API for the next 7 days. Each company with upcoming earnings becomes a signal.",
      };
    }
    // Default: Sonar web search from a Config query
    return {
      type: "search",
      visual: inferQueryFromSignal(signal),
      toolName: "Perplexity Sonar",
      toolIcon: PerplexityLogo,
      jobLabel,
      explanation: "Ran a search query from Config through Perplexity Sonar web search. Each distinct finding becomes a signal with extracted tickers, sentiment, and source URLs.",
    };
  }

  // Unknown job type
  return {
    type: "search",
    visual: inferQueryFromSignal(signal),
    toolName: "Perplexity Sonar",
    toolIcon: PerplexityLogo,
    jobLabel,
    explanation: "Discovered by the intelligence pipeline via web search.",
  };
}

/** Try to extract a representative domain from source URLs */
function extractDomainFromUrls(urls: string[]): string | null {
  for (const url of urls) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch { /* skip */ }
  }
  return null;
}

/** Build a readable inferred query from signal content when searchQuery is null */
function inferQueryFromSignal(signal: Signal): string {
  if (signal.tickers.length > 0) {
    return `${signal.tickers.join(", ")} ${signal.themes[0]?.toLowerCase().replace(/_/g, " ") ?? "news"}`;
  }
  if (signal.themes.length > 0) {
    return signal.themes.slice(0, 2).map(t => t.toLowerCase().replace(/_/g, " ")).join(", ");
  }
  return signal.headline.slice(0, 60);
}

/** Visual header matching config popover style */
function DiscoveryHeader({ discovery, signal }: { discovery: Discovery; signal: Signal }) {
  if (discovery.type === "portfolio") {
    // Ticker-focused: icon + ticker badge in a bar
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium text-foreground">{discovery.visual}</p>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {relativeTime(signal.createdAt)}
        </span>
      </div>
    );
  }

  if (discovery.type === "domain") {
    // Domain bar with lock icon (like config popover DomainVisual)
    return (
      <div className="space-y-1.5">
        {discovery.sourceName && (
          <p className="text-sm font-medium text-foreground">{discovery.sourceName}</p>
        )}
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground font-mono truncate">{discovery.visual}</p>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
            {relativeTime(signal.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  if (discovery.type === "api") {
    // API endpoint bar (like config popover ApiCallVisual)
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 font-mono">
        <Badge variant="secondary">
          GET
        </Badge>
        <p className="text-xs text-foreground truncate">{discovery.visual}</p>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0 font-sans">
          {relativeTime(signal.createdAt)}
        </span>
      </div>
    );
  }

  // search: Search bar (like config popover SearchQueryVisual)
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <p className="text-sm text-foreground truncate">{discovery.visual}</p>
      <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
        {relativeTime(signal.createdAt)}
      </span>
    </div>
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

const TOOL_CONFIG: Record<string, { name: string; icon: Icon }> = {
  PERPLEXITY_SONAR: { name: "Perplexity Sonar", icon: PerplexityLogo },
  FMP: { name: "Financial Modeling Prep", icon: BarChart3 },
  FINNHUB: { name: "Finnhub", icon: CalendarDays },
  FIRECRAWL: { name: "Firecrawl", icon: FirecrawlLogo },
};
