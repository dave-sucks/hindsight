"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Globe, Scan, Search, Shuffle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TickerBadge } from "@/components/ui/ticker-badge";
import { AnalystBadge } from "@/components/ui/analyst-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Favicon } from "@/components/intelligence/signal-feed";
import { PerplexityLogo, FirecrawlLogo } from "@/components/intelligence/icons";
import type { MatchedUniverse, RouteReasonCode, Signal } from "./types";
import {
  ROUTE_REASON_LABELS,
  ROUTE_REASON_TOOLTIPS,
  relativeTime,
} from "./types";

// ── Monitor type → icon ─────────────────────────────────────────────────────

const MONITOR_ICON = {
  SEARCH: Search,
  DOMAIN: Globe,
  API: Zap,
} as const;

function getMonitorType(signal: Signal): keyof typeof MONITOR_ICON {
  if (signal.monitor?.type === "DOMAIN" || signal.searchContext?.startsWith("domain_group:")) return "DOMAIN";
  if (signal.monitor?.type === "API" || signal.searchContext?.startsWith("market_movers:") || signal.searchContext === "earnings_calendar") return "API";
  return "SEARCH";
}

// ── Finding Detail Dialog ───────────────────────────────────────────────────

interface FindingDetailDialogProps {
  signal: Signal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FindingDetailDialog({ signal, open, onOpenChange }: FindingDetailDialogProps) {
  if (!signal) return null;

  const monitorType = getMonitorType(signal);
  const MonitorIcon = MONITOR_ICON[monitorType];
  const query = signal.searchQuery ?? signal.headline;
  const sentimentDir = signal.sentiment === "BULLISH" ? "up" as const
    : signal.sentiment === "BEARISH" ? "down" as const
    : null;

  const usedPerplexity = !signal.searchTool || signal.searchTool === "PERPLEXITY_SONAR";
  const usedFirecrawl = !!signal.artifactId;

  const hasUniverseTags =
    signal.sectors.length > 0 ||
    signal.industries.length > 0 ||
    signal.themes.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background sm:max-w-3xl">
        <TooltipProvider>
        {/* Search bar */}
        <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 min-w-0">
          <MonitorIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm text-foreground/80 truncate flex-1 min-w-0">{query}</span>
          {usedPerplexity && (
            <ToolPopover
              icon={PerplexityLogo}
              name="Perplexity Sonar"
              description="Real-time web search via Perplexity's Sonar API. Returns structured results with headlines, summaries, source URLs, and extracted tickers."
            />
          )}
          {usedFirecrawl && (
            <ToolPopover
              icon={FirecrawlLogo}
              name="Firecrawl"
              description="Full-page HTML extraction. The article was scraped and stored as a readable artifact so the AI agent can read the complete text during runs."
            />
          )}
        </div>

        {/* Tickers */}
        {signal.tickers.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {signal.tickers.map((t) => (
              <TickerBadge key={t} ticker={t} direction={sentimentDir} />
            ))}
          </div>
        )}

        <DialogHeader>
          <DialogTitle>{signal.headline}</DialogTitle>
          <DialogDescription>{signal.summary}</DialogDescription>
        </DialogHeader>

        {/* Universe tags — canonical sectors / industries / themes */}
        {hasUniverseTags && (
          <div className="space-y-1.5">
            {signal.sectors.length > 0 && (
              <UniverseTagRow label="Sectors" values={signal.sectors} />
            )}
            {signal.industries.length > 0 && (
              <UniverseTagRow label="Industries" values={signal.industries} />
            )}
            {signal.themes.length > 0 && (
              <UniverseTagRow label="Themes" values={signal.themes} />
            )}
          </div>
        )}

        {/* Scrollable content */}
        <div className="-mx-4 no-scrollbar max-h-[50vh] overflow-y-auto px-4">
          {/* Sources */}
          {signal.sourceUrls.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {signal.sourceUrls.map((url, i) => {
                let domain = url;
                try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* */ }
                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <Favicon domain={domain} size={14} />
                    {signal.sourceNames[i] ?? domain}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: routing provenance + timestamp */}
        <div className="border-t pt-3 space-y-2">
          {signal.routes && signal.routes.length > 0 ? (
            <>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Shuffle className="h-3 w-3" />
                <span>Routed to</span>
              </div>
              <div className="space-y-1.5">
                {signal.routes.map((r) => (
                  <RouteRow
                    key={r.id}
                    analystName={r.analyst.name}
                    code={r.routeReasonCode}
                    matched={r.matchedUniverse}
                    relevanceScore={r.relevanceScore}
                  />
                ))}
              </div>
            </>
          ) : null}
          <div className="flex items-center justify-end">
            <span className="text-xs text-muted-foreground tabular-nums">
              {relativeTime(signal.createdAt)}
            </span>
          </div>
        </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

// ── Universe tag row — label + canonical value chips ────────────────────────

function UniverseTagRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground w-20 shrink-0 pt-0.5">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <Badge key={v} variant="secondary">
            {v}
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ── Route row — analyst + reason code + matched dimension values ────────────

function RouteRow({
  analystName,
  code,
  matched,
  relevanceScore,
}: {
  analystName: string;
  code: RouteReasonCode | null;
  matched: MatchedUniverse | null;
  relevanceScore: number;
}) {
  const matchedValues = extractMatchedValues(matched);
  return (
    <div className="flex items-start gap-2 text-xs">
      <AnalystBadge name={analystName} icon={<Scan className="h-3 w-3" />} />
      {code && (
        <Tooltip>
          <TooltipTrigger render={<span className="cursor-help" />}>
            <Badge variant="secondary">{ROUTE_REASON_LABELS[code]}</Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {ROUTE_REASON_TOOLTIPS[code]}
          </TooltipContent>
        </Tooltip>
      )}
      {matchedValues.length > 0 && (
        <span className="text-muted-foreground truncate">
          {matchedValues.join(", ")}
        </span>
      )}
      <span className="ml-auto tabular-nums text-muted-foreground">
        {relevanceScore}
      </span>
    </div>
  );
}

function extractMatchedValues(m: MatchedUniverse | null): string[] {
  if (!m) return [];
  const out: string[] = [];
  if (m.sectors?.length) out.push(...m.sectors);
  if (m.industries?.length) out.push(...m.industries);
  if (m.themes?.length) out.push(...m.themes);
  if (m.inWatchlist) out.push("watchlist hit");
  if (m.inPositions) out.push("open position");
  return out;
}

// ── Tool Popover ────────────────────────────────────────────────────────────

function ToolPopover({
  icon: Icon,
  name,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  description: string;
}) {
  return (
    <Popover>
      <PopoverTrigger className="rounded-md p-1 hover:bg-background/60 transition-colors">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72 p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">{name}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </PopoverContent>
    </Popover>
  );
}
