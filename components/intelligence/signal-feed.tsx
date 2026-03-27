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
  ArrowDown,
  ArrowUp,
  BarChart3,
  CalendarDays,
  ExternalLink,
  FileText,
  Globe,
  Minus,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Signal } from "./types";
import {
  relativeTime,
  JOB_LABELS,
  URGENCY_CONFIG,
  SENTIMENT_CONFIG,
} from "./types";
import { PerplexityLogo, FirecrawlLogo, FinnhubLogo, FmpLogo } from "./icons";

type Icon = React.ComponentType<{ className?: string }>;

// ── Signal Feed ─────────────────────────────────────────────────────────────

interface SignalFeedProps {
  signals: Signal[];
}

export function SignalFeed({ signals }: SignalFeedProps) {
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
          {filtered.map((signal) =>
            signal.aggregateType ? (
              <AggregateFindingCard key={signal.id} signal={signal} />
            ) : (
              <SignalRow
                key={signal.id}
                signal={signal}
                onSelect={handleSelect}
              />
            )
          )}
        </div>

        {/* Detail sheet */}
        <Sheet
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
        >
          <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
            {selected && (
              <SignalDetail signal={selected} />
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
  onSelect,
}: {
  signal: Signal;
  onSelect: (signal: Signal) => void;
}) {
  const urgency = URGENCY_CONFIG[signal.urgency] ?? URGENCY_CONFIG.LOW;
  const primarySource = signal.sourceNames[0];
  const primaryDomain = extractDomainFromUrls(signal.sourceUrls);

  return (
    <Card
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelect(signal)}
    >
      <div className="space-y-2">
        {/* Row 1: sentiment arrow + headline + time */}
        <div className="flex items-start gap-2.5">
          <SentimentArrow sentiment={signal.sentiment} urgency={signal.urgency} />
          <p className="text-sm font-medium leading-tight flex-1 min-w-0">
            {signal.headline}
          </p>
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums mt-0.5">
            {relativeTime(signal.createdAt)}
          </span>
        </div>

        {/* Row 2: summary */}
        <p className="text-xs text-muted-foreground line-clamp-2 pl-6">
          {signal.summary}
        </p>

        {/* Row 3: source + tickers */}
        <div className="flex items-center gap-2 pl-6">
          {/* Source: favicon + name + domain */}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 shrink">
            {primaryDomain && (
              <Favicon domain={primaryDomain} />
            )}
            {primarySource && (
              <span className="text-foreground/80 truncate">{primarySource}</span>
            )}
            {primaryDomain && (
              <span className="text-muted-foreground/60 font-mono text-[11px] truncate hidden sm:inline">
                {primaryDomain}
              </span>
            )}
          </span>

          {signal.artifactId && (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <FileText className="h-3 w-3 text-muted-foreground/60" />
              </TooltipTrigger>
              <TooltipContent>Full article extracted</TooltipContent>
            </Tooltip>
          )}

          {/* Tickers — pushed right */}
          {signal.tickers.length > 0 && (
            <div className="flex items-center gap-1 ml-auto shrink-0">
              {signal.tickers.slice(0, 3).map((t) => (
                <Badge key={t} variant="secondary">
                  ${t}
                </Badge>
              ))}
              {signal.tickers.length > 3 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  +{signal.tickers.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Row 4: analyst routing badges */}
        {signal.routes && signal.routes.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-6">
            {signal.routes.slice(0, 4).map((r) => (
              <Tooltip key={r.id}>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Badge variant="outline" className="text-[10px]">
                    {r.analyst.name}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {r.relevanceScore}% — {formatRouteReason(r.routeReason)}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
});

// ── Signal Detail Sheet ─────────────────────────────────────────────────────

function SignalDetail({
  signal,
}: {
  signal: Signal;
}) {
  const sentiment = SENTIMENT_CONFIG[signal.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL;
  const discovery = inferDiscovery(signal);

  return (
    <>
      <SheetHeader className="space-y-4">
        {/* ── Headline + summary (hero) ───────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-start gap-2.5">
            <SentimentArrow sentiment={signal.sentiment} urgency={signal.urgency} />
            <SheetTitle className="text-left leading-tight flex-1">
              {signal.headline}
            </SheetTitle>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {signal.summary}
          </p>
        </div>
      </SheetHeader>

      <div className="px-6 pb-6 space-y-5">
        {/* ── Sources ──────────────────────────────────────────────── */}
        {signal.sourceUrls.length > 0 && (
          <div className="space-y-1.5">
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
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 -mx-2.5 hover:bg-accent/50 transition-colors group"
                >
                  <Favicon domain={domain} size={20} />
                  <span className="flex-1 min-w-0">
                    {name && (
                      <span className="text-sm text-foreground">{name}</span>
                    )}
                    <span className="text-xs text-muted-foreground font-mono ml-1.5">
                      {domain}
                    </span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              );
            })}
          </div>
        )}

        {/* ── Tickers + Sentiment ──────────────────────────────────── */}
        {(signal.tickers.length > 0 || signal.sentiment !== "NEUTRAL") && (
          <div className="flex flex-wrap items-center gap-2">
            {signal.tickers.map((t) => (
              <Badge key={t} variant="secondary">
                ${t}
              </Badge>
            ))}
            {signal.sentiment !== "NEUTRAL" && (
              <span className={cn("text-xs font-medium ml-auto", sentiment.className)}>
                {sentiment.label}
              </span>
            )}
          </div>
        )}

        {signal.artifactId && (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
            <FirecrawlLogo className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Full article extracted — available to agents during runs
            </span>
          </div>
        )}

        <Separator />

        {/* ── Discovery (how it was found) ────────────────────────── */}
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            How this was found
          </p>
          <div className="flex items-center gap-2 text-xs">
            <discovery.toolIcon className="h-4 w-4 shrink-0" />
            <span className="font-medium text-foreground">{discovery.toolName}</span>
            <span className="text-muted-foreground tabular-nums ml-auto">
              {relativeTime(signal.createdAt)}
            </span>
          </div>
          {signal.searchQuery && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <p className="text-xs text-foreground truncate">{signal.searchQuery}</p>
            </div>
          )}
          {signal.monitor?.name && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Via the <span className="text-foreground font-medium">{signal.monitor.name}</span> monitor
              {signal.monitor.type === "SEARCH" && " which searches this query daily via Perplexity Sonar"}
              {signal.monitor.type === "DOMAIN" && " which monitors this domain daily via Perplexity Sonar"}
              {signal.monitor.type === "API" && " which calls this API endpoint daily"}
              . Findings are scored and routed to matching analysts.
            </p>
          )}
        </div>

        {/* ── Routed to ───────────────────────────────────────────── */}
        {signal.routes && signal.routes.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Routed to
              </p>
              <div className="space-y-1.5">
                {signal.routes.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{r.analyst.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <span>{r.relevanceScore}%</span>
                      <span>{formatRouteReason(r.routeReason)}</span>
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
  type: "search" | "domain" | "api";
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
        type: "search",
        visual: signal.searchQuery ?? `${ticker} stock news developments catalysts today`,
        toolName,
        toolIcon,
        jobLabel,
        explanation: `Sent "${signal.searchQuery ?? `${ticker} stock news developments catalysts today`}" to Perplexity Sonar. Each result becomes a signal with tickers, sentiment, and sources.`,
      };
    }

    if (signal.searchContext?.startsWith("source_pack:") || signal.searchContext?.startsWith("domain_group:")) {
      const parts = signal.searchContext.includes("source_pack:")
        ? signal.searchContext.replace("source_pack:", "").split(":")
        : signal.searchContext.replace("domain_group:", "").split(":");
      const domains = (parts[1] ?? parts[0])?.split(",").slice(0, 3) ?? [];
      return {
        type: "domain",
        visual: domains[0] ?? "monitored domains",
        toolName,
        toolIcon,
        jobLabel,
        explanation: `Searched ${domains.length > 0 ? domains.join(", ") : "monitored domains"} via Perplexity Sonar (domain-filtered). High-priority domains also get full-page extraction via Firecrawl.`,
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
      type: "search",
      visual: `${ticker} stock news developments catalysts today`,
      toolName: "Perplexity Sonar",
      toolIcon: PerplexityLogo,
      jobLabel,
      explanation: `Sent "${ticker} stock news developments catalysts today" to Perplexity Sonar. Each result becomes a signal with tickers, sentiment, and sources.`,
    };
  }

  if (jobType === "DOMAIN_MONITOR" || jobType === "SOURCE_PACK") {
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

// ── Sentiment Arrow ──────────────────────────────────────────────────────────
// Replaces the urgency dot. Color comes from sentiment, intensity from urgency.

function SentimentArrow({ sentiment, urgency }: { sentiment: string; urgency: string }) {
  const isHigh = urgency === "HIGH" || urgency === "BREAKING";

  if (sentiment === "BULLISH") {
    return (
      <div className={cn("mt-0.5 shrink-0 rounded-full p-0.5", isHigh ? "bg-emerald-500/15" : "bg-emerald-500/10")}>
        <ArrowUp className={cn("h-3.5 w-3.5", isHigh ? "text-emerald-500" : "text-emerald-500/70")} />
      </div>
    );
  }
  if (sentiment === "BEARISH") {
    return (
      <div className={cn("mt-0.5 shrink-0 rounded-full p-0.5", isHigh ? "bg-red-500/15" : "bg-red-500/10")}>
        <ArrowDown className={cn("h-3.5 w-3.5", isHigh ? "text-red-500" : "text-red-500/70")} />
      </div>
    );
  }
  // NEUTRAL or MIXED
  return (
    <div className="mt-0.5 shrink-0 rounded-full p-0.5 bg-muted">
      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

// ── Favicon ──────────────────────────────────────────────────────────────────
// Uses Google's favicon service for any domain.

function Favicon({ domain, size = 16 }: { domain: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?sz=${size}&domain=${domain}`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-sm"
      loading="lazy"
    />
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

const TOOL_CONFIG: Record<string, { name: string; icon: Icon }> = {
  PERPLEXITY_SONAR: { name: "Perplexity Sonar", icon: PerplexityLogo },
  FMP: { name: "Financial Modeling Prep", icon: FmpLogo },
  FINNHUB: { name: "Finnhub", icon: FinnhubLogo },
  FIRECRAWL: { name: "Firecrawl", icon: FirecrawlLogo },
};

// ── Aggregate Finding Card ──────────────────────────────────────────────────

function AggregateFindingCard({ signal }: { signal: Signal }) {
  const data = (signal.dataPayload ?? []) as Array<Record<string, unknown>>;
  const isMovers = signal.aggregateType?.startsWith("MARKET_MOVERS");
  const isEarnings = signal.aggregateType === "EARNINGS_CALENDAR";

  const title = signal.aggregateType === "MARKET_MOVERS_GAINERS" ? "Top Gainers"
    : signal.aggregateType === "MARKET_MOVERS_LOSERS" ? "Top Losers"
    : signal.aggregateType === "MARKET_MOVERS_ACTIVES" ? "Most Active"
    : signal.aggregateType === "EARNINGS_CALENDAR" ? "Upcoming Earnings"
    : signal.headline;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {signal.monitor?.method === "finnhub"
            ? <FinnhubLogo className="h-4 w-4 text-muted-foreground" />
            : <FmpLogo className="h-4 w-4 text-muted-foreground" />}
          <p className="text-sm font-medium">{title}</p>
          <Badge variant="secondary">{signal.itemCount ?? data.length}</Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {relativeTime(signal.createdAt)}
        </span>
      </div>

      {isMovers && (
        <div className="space-y-1">
          {data.slice(0, 10).map((item, i) => {
            const change = Number(item.change ?? 0);
            const isPositive = change >= 0;
            return (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">${String(item.ticker)}</Badge>
                </div>
                <div className="flex items-center gap-4 tabular-nums">
                  <span className={cn(
                    "text-xs",
                    isPositive ? "text-emerald-500" : "text-red-500"
                  )}>
                    {isPositive ? "+" : ""}{change.toFixed(1)}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ${Number(item.price ?? 0).toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isEarnings && (
        <div className="space-y-1">
          {data.slice(0, 10).map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <Badge variant="secondary">${String(item.ticker)}</Badge>
              <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                <span>{String(item.date ?? "")}</span>
                {item.epsEstimate != null && <span>EPS est: ${Number(item.epsEstimate).toFixed(2)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isMovers && !isEarnings && (
        <p className="text-sm text-muted-foreground">{signal.summary}</p>
      )}
    </Card>
  );
}

// ── Route reason formatting ─────────────────────────────────────────────────

function formatRouteReason(reason: string): string {
  return reason
    .split(", ")
    .map((r) => {
      const [type, value] = r.split(":");
      if (type === "ticker_match") return `${value} match`;
      if (type === "sector_match") return `${value} sector`;
      if (type === "theme_match") return value?.replace(/_/g, " ");
      return r;
    })
    .slice(0, 2)
    .join(", ");
}
