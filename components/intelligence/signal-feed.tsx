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
  Globe,
  Search,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Signal } from "./types";
import { relativeTime, JOB_LABELS, URGENCY_CONFIG, SENTIMENT_CONFIG } from "./types";
import { PerplexityLogo, FirecrawlLogo } from "./icons";

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
              <SelectItem value="ALL">All types</SelectItem>
              {signalTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {SIGNAL_TYPE_LABELS[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={urgencyFilter} onValueChange={(val) => val && setUrgencyFilter(val)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All urgency</SelectItem>
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
            {selected && <SignalDetail signal={selected} />}
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

// ── Signal Row ──────────────────────────────────────────────────────────────
// Clean, news-reader style. Left border = urgency. Source attribution first.

const SignalRow = memo(function SignalRow({
  signal,
  onSelect,
}: {
  signal: Signal;
  onSelect: (signal: Signal) => void;
}) {
  const urgency = URGENCY_CONFIG[signal.urgency] ?? URGENCY_CONFIG.LOW;
  const source = getSourceAttribution(signal);
  const sentimentCfg = SENTIMENT_CONFIG[signal.sentiment];

  return (
    <Card
      className={cn(
        "p-4 cursor-pointer hover:bg-accent/50 transition-colors border-l-2",
        URGENCY_BORDER[signal.urgency] ?? "border-l-transparent"
      )}
      onClick={() => onSelect(signal)}
    >
      <div className="space-y-1.5">
        {/* Headline */}
        <p className="text-sm font-medium leading-tight">{signal.headline}</p>

        {/* Summary — 1 line */}
        <p className="text-xs text-muted-foreground line-clamp-1">
          {signal.summary}
        </p>

        {/* Attribution row: source · tickers · sentiment indicator · time */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {/* Source */}
          <span className="flex items-center gap-1 shrink-0">
            <source.icon className="h-3 w-3" />
            {source.name}
          </span>

          {signal.sourceNames[0] && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate max-w-[120px]">{signal.sourceNames[0]}</span>
            </>
          )}

          {/* Tickers (max 3) */}
          {signal.tickers.length > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-1">
                {signal.tickers.slice(0, 3).map((t) => (
                  <span key={t} className="font-medium text-foreground">
                    ${t}
                  </span>
                ))}
                {signal.tickers.length > 3 && (
                  <span>+{signal.tickers.length - 3}</span>
                )}
              </span>
            </>
          )}

          {/* Sentiment */}
          {sentimentCfg && signal.sentiment !== "NEUTRAL" && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className={cn("font-medium", sentimentCfg.className)}>
                {sentimentCfg.label}
              </span>
            </>
          )}

          {/* Full article indicator */}
          {signal.artifactId && (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <FileText className="h-3 w-3" />
              </TooltipTrigger>
              <TooltipContent>Full article extracted</TooltipContent>
            </Tooltip>
          )}

          {/* Time — pushed right */}
          <span className="ml-auto shrink-0 tabular-nums">
            {relativeTime(signal.createdAt)}
          </span>
        </div>
      </div>
    </Card>
  );
});

// ── Signal Detail Sheet ─────────────────────────────────────────────────────
// Completely redesigned: provenance-first, source preview, no badge spam.

function SignalDetail({ signal }: { signal: Signal }) {
  const urgency = URGENCY_CONFIG[signal.urgency] ?? URGENCY_CONFIG.LOW;
  const sentiment = SENTIMENT_CONFIG[signal.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL;
  const provenance = buildProvenance(signal);

  return (
    <>
      <SheetHeader className="space-y-4">
        {/* Source preview card — if we have URLs */}
        {signal.sourceUrls.length > 0 && (
          <div className="space-y-2">
            {signal.sourceUrls.slice(0, 3).map((url, i) => (
              <SourcePreviewCard
                key={i}
                url={url}
                name={signal.sourceNames[i] ?? undefined}
              />
            ))}
          </div>
        )}

        {/* Headline + summary */}
        <div className="space-y-2">
          <SheetTitle className="text-left leading-tight">
            {signal.headline}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">{signal.summary}</p>
          {signal.evidence && signal.evidence !== signal.summary && (
            <p className="text-sm text-muted-foreground/80">{signal.evidence}</p>
          )}
        </div>
      </SheetHeader>

      <div className="px-6 pb-6 space-y-5">
        {/* ── Provenance: How this was found ─────────────────────────── */}
        <div className="rounded-lg bg-muted/50 p-4 space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            How this was found
          </p>

          {/* Tool + job */}
          <div className="flex items-center gap-2 text-sm">
            <provenance.toolIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium">{provenance.toolName}</span>
            <span className="text-muted-foreground">
              during {provenance.jobLabel}
            </span>
          </div>

          {/* The actual query/endpoint/trigger */}
          {provenance.query && (
            <div className="rounded-md bg-background border px-3 py-2">
              {provenance.queryType === "api" ? (
                <div className="flex items-center gap-2 font-mono text-xs">
                  <Badge variant="secondary">GET</Badge>
                  <span className="text-foreground">{provenance.query}</span>
                </div>
              ) : provenance.queryType === "domain" ? (
                <div className="flex items-center gap-2 text-xs">
                  <Globe className="h-3 w-3 text-muted-foreground" />
                  <span className="text-foreground font-mono">{provenance.query}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <Search className="h-3 w-3 text-muted-foreground" />
                  <span className="text-foreground">{provenance.query}</span>
                </div>
              )}
            </div>
          )}

          {/* Why — the context */}
          {provenance.reason && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {provenance.reason}
            </p>
          )}
        </div>

        {/* ── Context line: Type · Urgency · Sentiment · Freshness ─── */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{SIGNAL_TYPE_LABELS[signal.type] ?? signal.type}</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", urgency.dot)} />
            {urgency.label}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className={sentiment.className}>{sentiment.label}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{signal.freshness.charAt(0) + signal.freshness.slice(1).toLowerCase().replace(/_/g, " ")}</span>
          <span className="ml-auto tabular-nums">{relativeTime(signal.createdAt)}</span>
        </div>

        {/* ── Tickers ─────────────────────────────────────────────────── */}
        {signal.tickers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {signal.tickers.map((t) => (
              <Badge key={t} variant="secondary">
                ${t}
              </Badge>
            ))}
          </div>
        )}

        {/* ── Themes + Sectors (collapsed into one line if few) ────── */}
        {(signal.themes.length > 0 || signal.sectors.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {signal.themes.map((t) => (
              <span key={t} className="px-2 py-0.5 rounded-full bg-muted">
                {t.toLowerCase().replace(/_/g, " ")}
              </span>
            ))}
            {signal.sectors.map((s) => (
              <span key={s} className="px-2 py-0.5 rounded-full bg-muted">
                {s.toLowerCase()}
              </span>
            ))}
          </div>
        )}

        {/* ── Quality ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Source quality{" "}
            <span className="text-foreground tabular-nums">{signal.sourceQuality}/5</span>
          </span>
          <span>
            Novelty{" "}
            <span className="text-foreground tabular-nums">{signal.noveltyScore}/100</span>
          </span>
        </div>

        {/* ── Full article indicator ─────────────────────────────────── */}
        {signal.artifactId && (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
            <FirecrawlLogo className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Full article extracted via Firecrawl
            </span>
          </div>
        )}

        {/* ── Routed to (per-signal, not aggregate) ──────────────────── */}
        {signal.analystRoutes && signal.analystRoutes.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Routed to
              </p>
              <div className="space-y-1.5">
                {signal.analystRoutes.map((route) => (
                  <div
                    key={route.analyst.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span>{route.analyst.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{route.relevanceScore}%</span>
                      {route.routeReason && (
                        <Tooltip>
                          <TooltipTrigger render={<span className="underline decoration-dotted cursor-help" />}>
                            {formatRouteReason(route.routeReason)}
                          </TooltipTrigger>
                          <TooltipContent>{route.routeReason}</TooltipContent>
                        </Tooltip>
                      )}
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

// ── Source Preview Card ──────────────────────────────────────────────────────
// A clean card showing source URL with favicon and domain

function SourcePreviewCard({ url, name }: { url: string; name?: string }) {
  let domain = url;
  let faviconUrl = "";
  try {
    const parsed = new URL(url);
    domain = parsed.hostname.replace(/^www\./, "");
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    /* keep raw */
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent/50 transition-colors group"
    >
      {faviconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={faviconUrl}
          alt=""
          className="h-4 w-4 shrink-0 rounded-sm"
          loading="lazy"
        />
      ) : (
        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <div className="flex-1 min-w-0">
        {name && <p className="text-sm font-medium truncate">{name}</p>}
        <p className="text-xs text-muted-foreground truncate">{domain}</p>
      </div>
      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </a>
  );
}

// ── Provenance Builder ──────────────────────────────────────────────────────
// Constructs human-readable provenance from signal metadata

interface Provenance {
  toolName: string;
  toolIcon: Icon;
  jobLabel: string;
  query: string | null;
  queryType: "search" | "api" | "domain";
  reason: string | null;
}

function buildProvenance(signal: Signal): Provenance {
  const jobType = signal.batch?.jobType;
  const jobLabel = JOB_LABELS[jobType] ?? jobType ?? "Intelligence";

  // With provenance data
  if (signal.searchTool) {
    const toolCfg = TOOL_CONFIG[signal.searchTool];
    const toolName = toolCfg?.name ?? signal.searchTool;
    const toolIcon = toolCfg?.icon ?? Globe;

    if (signal.searchContext?.startsWith("ticker:")) {
      const ticker = signal.searchContext.replace("ticker:", "");
      return {
        toolName,
        toolIcon,
        jobLabel,
        query: signal.searchQuery ?? `${ticker} stock news developments catalysts today`,
        queryType: "search",
        reason: `${ticker} is in an open position or on a watchlist. The portfolio monitor searches for ticker-specific news that broad market sweeps might miss.`,
      };
    }

    if (signal.searchContext?.startsWith("source_pack:")) {
      const parts = signal.searchContext.replace("source_pack:", "").split(":");
      const packName = parts[0] ?? "Sources";
      const domains = parts[1]?.split(",").slice(0, 3) ?? [];
      return {
        toolName,
        toolIcon,
        jobLabel,
        query: domains.join(", ") || packName,
        queryType: "domain",
        reason: `Domain-filtered search against the "${packName}" source pack. High-value pages get full text extraction via Firecrawl for deeper analysis.`,
      };
    }

    if (signal.searchContext?.startsWith("market_movers:")) {
      const label = signal.searchContext.replace("market_movers:", "");
      return {
        toolName,
        toolIcon,
        jobLabel,
        query: signal.searchQuery ?? `/stock_market/${label}`,
        queryType: "api",
        reason: `FMP market movers API — top 10 ${label}. Each result becomes a signal with price change and volume data.`,
      };
    }

    if (signal.searchContext === "earnings_calendar") {
      return {
        toolName,
        toolIcon,
        jobLabel,
        query: signal.searchQuery ?? "/calendar/earnings",
        queryType: "api",
        reason: "Finnhub earnings calendar for the next 7 days. Companies reporting soon get higher urgency.",
      };
    }

    if (signal.searchContext?.startsWith("query:")) {
      const parts = signal.searchContext.replace("query:", "").split(":");
      const category = parts[0] ?? "";
      return {
        toolName,
        toolIcon,
        jobLabel,
        query: signal.searchQuery,
        queryType: "search",
        reason: `From a ${category.toLowerCase()} intelligence query in your Config. Sonar searches the web and returns structured findings with tickers, sentiment, and sources.`,
      };
    }

    // Generic with searchTool but no recognized context
    return {
      toolName,
      toolIcon,
      jobLabel,
      query: signal.searchQuery,
      queryType: "search",
      reason: null,
    };
  }

  // ── Fallback: infer from batch jobType ─────────────────────────────────
  if (jobType === "PORTFOLIO_MONITOR") {
    const ticker = signal.tickers[0] ?? "positions";
    return {
      toolName: "Perplexity Sonar",
      toolIcon: PerplexityLogo,
      jobLabel,
      query: `${ticker} stock news developments catalysts today`,
      queryType: "search",
      reason: `${ticker} is in an open position or on a watchlist.`,
    };
  }

  if (jobType === "SOURCE_PACK") {
    const domain = extractDomainFromUrls(signal.sourceUrls);
    return {
      toolName: "Perplexity Sonar",
      toolIcon: PerplexityLogo,
      jobLabel,
      query: domain,
      queryType: "domain",
      reason: "Searched monitored domains via domain-filtered Sonar search.",
    };
  }

  if (jobType === "MARKET_SWEEP") {
    if (signal.sourceNames.includes("FMP")) {
      return {
        toolName: "Financial Modeling Prep",
        toolIcon: BarChart3,
        jobLabel,
        query: "/stock_market/movers",
        queryType: "api",
        reason: "FMP market movers API (gainers, losers, most active). Top 10 per category.",
      };
    }
    if (signal.sourceNames.includes("Finnhub")) {
      return {
        toolName: "Finnhub",
        toolIcon: CalendarDays,
        jobLabel,
        query: "/calendar/earnings",
        queryType: "api",
        reason: "Finnhub earnings calendar for the next 7 days.",
      };
    }
    return {
      toolName: "Perplexity Sonar",
      toolIcon: PerplexityLogo,
      jobLabel,
      query: inferQueryFromSignal(signal),
      queryType: "search",
      reason: "From a search query in your Config.",
    };
  }

  return {
    toolName: "Perplexity Sonar",
    toolIcon: PerplexityLogo,
    jobLabel,
    query: inferQueryFromSignal(signal),
    queryType: "search",
    reason: null,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractDomainFromUrls(urls: string[]): string | null {
  for (const url of urls) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* skip */
    }
  }
  return null;
}

function inferQueryFromSignal(signal: Signal): string {
  if (signal.tickers.length > 0) {
    return `${signal.tickers.join(", ")} ${signal.themes[0]?.toLowerCase().replace(/_/g, " ") ?? "news"}`;
  }
  if (signal.themes.length > 0) {
    return signal.themes
      .slice(0, 2)
      .map((t) => t.toLowerCase().replace(/_/g, " "))
      .join(", ");
  }
  return signal.headline.slice(0, 60);
}

function getSourceAttribution(signal: Signal): { name: string; icon: Icon } {
  if (signal.searchTool) {
    return TOOL_CONFIG[signal.searchTool] ?? { name: signal.searchTool, icon: Globe };
  }
  // Fallback from batch
  const jobType = signal.batch?.jobType;
  if (jobType === "PORTFOLIO_MONITOR") return TOOL_CONFIG.PERPLEXITY_SONAR;
  if (jobType === "SOURCE_PACK") return TOOL_CONFIG.PERPLEXITY_SONAR;
  if (signal.sourceNames.includes("FMP")) return TOOL_CONFIG.FMP;
  if (signal.sourceNames.includes("Finnhub")) return TOOL_CONFIG.FINNHUB;
  return TOOL_CONFIG.PERPLEXITY_SONAR;
}

function formatRouteReason(reason: string): string {
  if (reason.startsWith("ticker_match:")) return "ticker match";
  if (reason.startsWith("sector_match:")) return "sector match";
  if (reason.startsWith("theme_match:")) return "theme match";
  return reason.split(",")[0] ?? reason;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TOOL_CONFIG: Record<string, { name: string; icon: Icon }> = {
  PERPLEXITY_SONAR: { name: "Perplexity Sonar", icon: PerplexityLogo },
  FMP: { name: "FMP", icon: BarChart3 },
  FINNHUB: { name: "Finnhub", icon: CalendarDays },
  FIRECRAWL: { name: "Firecrawl", icon: FirecrawlLogo },
};

const URGENCY_BORDER: Record<string, string> = {
  BREAKING: "border-l-red-500",
  HIGH: "border-l-amber-500",
  MEDIUM: "border-l-blue-500",
  LOW: "border-l-transparent",
};

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  NEWS: "News",
  EARNINGS: "Earnings",
  FILING: "SEC Filing",
  SOCIAL: "Social",
  PRICE_ACTION: "Price Action",
  ANALYST_NOTE: "Analyst Note",
  OPTIONS: "Options",
  MACRO: "Macro",
  SECTOR: "Sector",
};
