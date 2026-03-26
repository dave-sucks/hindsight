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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Eye,
  TrendingUp,
  TrendingDown,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Signal } from "./types";
import {
  relativeTime,
  URGENCY_CONFIG,
  SENTIMENT_CONFIG,
  THEME_LABELS,
  MONITOR_METHOD_CONFIG,
} from "./types";
import { PerplexityLogo, FirecrawlLogo, FinnhubLogo, FmpLogo } from "./icons";

type Icon = React.ComponentType<{ className?: string }>;

// ── Finding Feed ────────────────────────────────────────────────────────────

interface FindingFeedProps {
  signals: Signal[];
}

export function FindingFeed({ signals }: FindingFeedProps) {
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
              placeholder="Search findings..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={typeFilter}
            onValueChange={(val) => val && setTypeFilter(val)}
          >
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
          <Select
            value={urgencyFilter}
            onValueChange={(val) => val && setUrgencyFilter(val)}
          >
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
            {filtered.length} findings
          </span>
        </div>

        {/* Finding list */}
        <div className="space-y-2">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No findings match your filters
            </p>
          )}
          {filtered.map((signal) =>
            signal.aggregateType ? (
              <AggregateFindingCard
                key={signal.id}
                signal={signal}
                onSelect={handleSelect}
              />
            ) : (
              <FindingRow
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
            {selected && <FindingDetail signal={selected} />}
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

// ── Aggregate Finding Card ──────────────────────────────────────────────────

const AGGREGATE_CONFIG: Record<
  string,
  { title: string; icon: Icon; changeLabel: string }
> = {
  MARKET_MOVERS_GAINERS: {
    title: "Top Gainers",
    icon: TrendingUp,
    changeLabel: "Change",
  },
  MARKET_MOVERS_LOSERS: {
    title: "Top Losers",
    icon: TrendingDown,
    changeLabel: "Change",
  },
  MARKET_MOVERS_ACTIVES: {
    title: "Most Active",
    icon: Activity,
    changeLabel: "Volume",
  },
  EARNINGS_CALENDAR: {
    title: "Upcoming Earnings",
    icon: CalendarDays,
    changeLabel: "EPS Est",
  },
};

function AggregateFindingCard({
  signal,
  onSelect,
}: {
  signal: Signal;
  onSelect: (signal: Signal) => void;
}) {
  const aggConfig =
    AGGREGATE_CONFIG[signal.aggregateType ?? ""] ?? {
      title: signal.headline,
      icon: BarChart3,
      changeLabel: "Value",
    };
  const AggIcon = aggConfig.icon;
  const items = Array.isArray(signal.dataPayload)
    ? (signal.dataPayload as Record<string, unknown>[])
    : [];
  const isEarnings = signal.aggregateType === "EARNINGS_CALENDAR";
  const isActive = signal.aggregateType === "MARKET_MOVERS_ACTIVES";

  return (
    <Card
      className="p-6 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelect(signal)}
    >
      <div className="flex items-center gap-2 mb-3">
        <AggIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{aggConfig.title}</span>
        <SignalProviderBadge signal={signal} />
        {signal.itemCount != null && (
          <Badge variant="secondary">
            <span className="tabular-nums">{signal.itemCount}</span> items
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {relativeTime(signal.createdAt)}
        </span>
      </div>

      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              {isEarnings ? (
                <>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">EPS Est</TableHead>
                  <TableHead className="text-right">Rev Est</TableHead>
                </>
              ) : isActive ? (
                <>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </>
              ) : (
                <>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.slice(0, 10).map((item, i) => {
              const ticker =
                (item.ticker as string) ?? (item.symbol as string) ?? "—";
              if (isEarnings) {
                const date = (item.date as string) ?? "—";
                const epsEst = item.epsEstimate ?? item.epsEst ?? "—";
                const revEst = item.revenueEstimate ?? item.revEst ?? "—";
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">
                      {ticker}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(date)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatNumber(epsEst)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {formatNumber(revEst)}
                    </TableCell>
                  </TableRow>
                );
              }
              if (isActive) {
                const volume = item.volume ?? "—";
                const price = item.price ?? item.changesPercentage ?? "—";
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">
                      {ticker}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {formatVolume(volume)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatNumber(price)}
                    </TableCell>
                  </TableRow>
                );
              }
              // Gainers / Losers
              const change = item.changesPercentage ?? item.change ?? 0;
              const changeNum =
                typeof change === "number" ? change : parseFloat(String(change));
              const price = item.price ?? "—";
              return (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{ticker}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm tabular-nums",
                      changeNum > 0 && "text-emerald-500",
                      changeNum < 0 && "text-red-500"
                    )}
                  >
                    {changeNum > 0 ? "+" : ""}
                    {isNaN(changeNum)
                      ? String(change)
                      : `${changeNum.toFixed(2)}%`}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatNumber(price)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ── Finding Row ─────────────────────────────────────────────────────────────

const FindingRow = memo(function FindingRow({
  signal,
  onSelect,
}: {
  signal: Signal;
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
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                urgency.dot
              )}
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

            {/* Provider attribution */}
            <SignalProviderBadge signal={signal} />

            {/* Monitor name */}
            <span className="text-xs text-muted-foreground">
              {signal.monitor
                ? `via ${signal.monitor.name}`
                : signal.sourceNames[0]
                  ? `via ${signal.sourceNames[0]}`
                  : "via Intelligence"}
            </span>

            {/* Sentiment (only if not NEUTRAL) */}
            {signal.sentiment !== "NEUTRAL" && (
              <>
                <Separator orientation="vertical" className="h-3" />
                <span className={cn("text-xs font-medium", sentiment.className)}>
                  {sentiment.label}
                </span>
              </>
            )}

            <Separator orientation="vertical" className="h-3" />

            {/* Type */}
            <span className="text-xs text-muted-foreground">{signal.type}</span>

            {signal.artifactId && (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <FileText className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>Full article available</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Per-signal routing */}
          {signal.routes.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {signal.routes.slice(0, 4).map((route) => (
                <Tooltip key={route.id}>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    <Badge variant="outline" className="text-[10px]">
                      {route.analyst.name}
                      <span
                        className={cn(
                          "ml-1 inline-block h-1.5 w-1.5 rounded-full",
                          route.relevanceScore >= 0.7
                            ? "bg-emerald-500"
                            : route.relevanceScore >= 0.4
                              ? "bg-amber-500"
                              : "bg-muted-foreground/40"
                        )}
                      />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Relevance: {Math.round(route.relevanceScore * 100)}% —{" "}
                    {formatRouteReason(route.routeReason)}
                  </TooltipContent>
                </Tooltip>
              ))}
              {signal.routes.length > 4 && (
                <span className="text-[10px] text-muted-foreground">
                  +{signal.routes.length - 4}
                </span>
              )}
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

// ── Finding Detail Sheet ────────────────────────────────────────────────────

function FindingDetail({ signal }: { signal: Signal }) {
  const urgency = URGENCY_CONFIG[signal.urgency] ?? URGENCY_CONFIG.LOW;
  const sentiment = SENTIMENT_CONFIG[signal.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL;
  const discovery = inferDiscoveryFromMonitor(signal);

  return (
    <>
      <SheetHeader className="space-y-4">
        {/* Discovery header */}
        <FindingDiscoveryHeader discovery={discovery} signal={signal} />

        {/* Title + summary */}
        <div className="space-y-2">
          <SheetTitle className="text-left leading-tight">
            {signal.headline}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">{signal.summary}</p>
        </div>
      </SheetHeader>

      <div className="px-6 pb-6 space-y-5">
        {/* Classification badges (just type + urgency) */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{signal.type}</Badge>
          <Badge variant="secondary">
            <span
              className={cn(
                "mr-1.5 inline-block h-1.5 w-1.5 rounded-full",
                urgency.dot
              )}
            />
            {urgency.label}
          </Badge>
          {signal.sentiment !== "NEUTRAL" && (
            <Badge variant="secondary">
              <span className={cn("mr-1", sentiment.className)}>
                {sentiment.label}
              </span>
            </Badge>
          )}
        </div>

        {/* Tickers */}
        {signal.tickers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-1">
              Tickers
            </span>
            {signal.tickers.map((t) => (
              <Badge key={t} variant="secondary">
                ${t}
              </Badge>
            ))}
          </div>
        )}

        {/* Themes (translated, top 3) */}
        {signal.themes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-1">
              Themes
            </span>
            {signal.themes.slice(0, 3).map((t) => (
              <Badge key={t} variant="outline">
                {THEME_LABELS[t] ?? t.toLowerCase().replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        )}

        <Separator />

        {/* Provenance section */}
        <div className="text-xs space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Provenance
          </p>
          <div className="flex items-center gap-2">
            <discovery.providerIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium text-foreground">
              {discovery.providerName}
            </span>
            <span className="ml-auto text-muted-foreground tabular-nums">
              {relativeTime(signal.createdAt)}
            </span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {discovery.action}
          </p>
          {signal.monitor && (
            <p className="text-muted-foreground">
              Found via: {signal.monitor.name}
            </p>
          )}
        </div>

        {/* Quality scores */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Source Quality{" "}
            <span className="text-foreground tabular-nums">
              {signal.sourceQuality}/5
            </span>
          </span>
          <span>
            Novelty{" "}
            <span className="text-foreground tabular-nums">
              {signal.noveltyScore}/100
            </span>
          </span>
        </div>

        {/* Per-signal routing */}
        {signal.routes.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Routed to
              </p>
              <div className="space-y-1.5">
                {signal.routes.map((route) => (
                  <div
                    key={route.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span>{route.analyst.name}</span>
                      <RelevanceIndicator score={route.relevanceScore} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatRouteReason(route.routeReason)}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {route.status === "ACTED_ON"
                          ? "Acted"
                          : route.status === "READ"
                            ? "Read"
                            : "Pending"}
                      </Badge>
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
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sources
              </p>
              <div className="space-y-1">
                {signal.sourceUrls.map((url, i) => {
                  let domain = url;
                  let favicon: string | null = null;
                  try {
                    const parsed = new URL(url);
                    domain = parsed.hostname.replace(/^www\./, "");
                    favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
                  } catch {
                    /* keep raw */
                  }
                  const name = signal.sourceNames[i];
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 text-sm hover:bg-accent/50 transition-colors group"
                    >
                      {favicon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={favicon}
                          alt=""
                          className="h-3.5 w-3.5 shrink-0 rounded-sm"
                        />
                      ) : (
                        <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
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
      </div>
    </>
  );
}

// ── Relevance Indicator ─────────────────────────────────────────────────────

function RelevanceIndicator({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <span
      className={cn(
        "text-xs tabular-nums font-medium",
        score >= 0.7
          ? "text-emerald-500"
          : score >= 0.4
            ? "text-amber-500"
            : "text-muted-foreground"
      )}
    >
      {pct}%
    </span>
  );
}

// ── Signal Provider Badge (inline) ──────────────────────────────────────────

function SignalProviderBadge({ signal }: { signal: Signal }) {
  const method = signal.monitor?.method ?? signal.searchTool;
  if (!method) return null;

  const config: Record<string, { icon: Icon; label: string }> = {
    perplexity_sonar: { icon: PerplexityLogo, label: "Perplexity" },
    PERPLEXITY_SONAR: { icon: PerplexityLogo, label: "Perplexity" },
    firecrawl: { icon: FirecrawlLogo, label: "Firecrawl" },
    FIRECRAWL: { icon: FirecrawlLogo, label: "Firecrawl" },
    fmp: { icon: FmpLogo, label: "FMP" },
    FMP: { icon: FmpLogo, label: "FMP" },
    finnhub: { icon: FinnhubLogo, label: "Finnhub" },
    FINNHUB: { icon: FinnhubLogo, label: "Finnhub" },
  };

  const cfg = config[method];
  if (!cfg) return null;

  const ProvIcon = cfg.icon;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <ProvIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>{cfg.label}</TooltipContent>
    </Tooltip>
  );
}

// ── Discovery from Monitor ──────────────────────────────────────────────────

interface MonitorDiscovery {
  type: "search" | "domain" | "api" | "portfolio" | "watchlist";
  visual: string;
  providerName: string;
  providerIcon: Icon;
  action: string;
  sourceName?: string;
}

function inferDiscoveryFromMonitor(signal: Signal): MonitorDiscovery {
  const monitor = signal.monitor;

  if (monitor) {
    const config = monitor.config as Record<string, unknown> | null;
    const methodLabel =
      MONITOR_METHOD_CONFIG[monitor.method]?.label ?? monitor.method;

    if (monitor.type === "SEARCH") {
      const query = (config?.query as string) ?? signal.searchQuery ?? monitor.name;
      return {
        type: "search",
        visual: query,
        providerName: methodLabel,
        providerIcon: PerplexityLogo,
        action: `Searched: "${query}"`,
      };
    }

    if (monitor.type === "DOMAIN") {
      const domain = (config?.domain as string) ?? monitor.name;
      return {
        type: "domain",
        visual: domain,
        providerName: methodLabel,
        providerIcon:
          monitor.method === "firecrawl" ? FirecrawlLogo : PerplexityLogo,
        action: `Crawled: ${domain}`,
        sourceName: monitor.name,
      };
    }

    if (monitor.type === "API") {
      const endpoint = (config?.endpoint as string) ?? monitor.name;
      return {
        type: "api",
        visual: endpoint,
        providerName: methodLabel,
        providerIcon: monitor.method === "finnhub" ? FinnhubLogo : FmpLogo,
        action: `Called: ${endpoint}`,
      };
    }

    if (monitor.type === "PORTFOLIO") {
      return {
        type: "portfolio",
        visual: signal.tickers.length > 0
          ? signal.tickers.slice(0, 3).map((t) => `$${t}`).join(", ")
          : "Open positions",
        providerName: methodLabel,
        providerIcon: PerplexityLogo,
        action: `Monitored open position for news and price alerts`,
      };
    }

    if (monitor.type === "WATCHLIST") {
      return {
        type: "watchlist",
        visual: signal.tickers.length > 0
          ? signal.tickers.slice(0, 3).map((t) => `$${t}`).join(", ")
          : "Watchlist items",
        providerName: methodLabel,
        providerIcon: PerplexityLogo,
        action: `Monitored watchlist item for developments and catalysts`,
      };
    }
  }

  // Fallback: use searchQuery / searchTool
  if (signal.searchQuery) {
    return {
      type: "search",
      visual: signal.searchQuery,
      providerName: "Perplexity Sonar",
      providerIcon: PerplexityLogo,
      action: `Searched: "${signal.searchQuery}"`,
    };
  }

  return {
    type: "search",
    visual: signal.headline.slice(0, 60),
    providerName: "Intelligence",
    providerIcon: Search as Icon,
    action: "Discovered by the intelligence pipeline",
  };
}

// ── Finding Discovery Header ────────────────────────────────────────────────

function FindingDiscoveryHeader({
  discovery,
  signal,
}: {
  discovery: MonitorDiscovery;
  signal: Signal;
}) {
  if (discovery.type === "search") {
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

  if (discovery.type === "domain") {
    return (
      <div className="space-y-1.5">
        {discovery.sourceName && (
          <p className="text-sm font-medium text-foreground">
            {discovery.sourceName}
          </p>
        )}
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground font-mono truncate">
            {discovery.visual}
          </p>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
            {relativeTime(signal.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  if (discovery.type === "api") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 font-mono">
        <Badge variant="secondary">GET</Badge>
        <p className="text-xs text-foreground truncate">{discovery.visual}</p>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0 font-sans">
          {relativeTime(signal.createdAt)}
        </span>
      </div>
    );
  }

  if (discovery.type === "portfolio") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium text-foreground">
          {discovery.visual}
        </p>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {relativeTime(signal.createdAt)}
        </span>
      </div>
    );
  }

  if (discovery.type === "watchlist") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
        <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium text-foreground">
          {discovery.visual}
        </p>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {relativeTime(signal.createdAt)}
        </span>
      </div>
    );
  }

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRouteReason(reason: string): string {
  if (!reason) return "";
  // Parse "ticker_match:NVDA" → "Matches NVDA in watchlist"
  if (reason.startsWith("ticker_match:")) {
    const ticker = reason.replace("ticker_match:", "");
    return `Matches ${ticker} in watchlist`;
  }
  if (reason.startsWith("sector_match:")) {
    const sector = reason.replace("sector_match:", "");
    return `Covers ${sector} sector`;
  }
  if (reason.startsWith("theme_match:")) {
    const theme = reason.replace("theme_match:", "");
    const label =
      THEME_LABELS[theme] ?? theme.toLowerCase().replace(/_/g, " ");
    return `Tracks ${label}`;
  }
  if (reason.startsWith("category_match:")) {
    const cat = reason.replace("category_match:", "");
    return `Monitors ${cat.toLowerCase()} category`;
  }
  return reason;
}

function formatNumber(val: unknown): string {
  if (val == null || val === "—") return "—";
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(num)) return String(val);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(val: unknown): string {
  if (val == null || val === "—") return "—";
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(num)) return String(val);
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr === "—") return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}
