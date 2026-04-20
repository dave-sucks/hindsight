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
import { Badge } from "@/components/ui/badge";
import { StockLogo } from "@/components/StockLogo";
import { TickerChip } from "@/components/chat/TickerChip";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Favicon } from "@/components/intelligence/signal-feed";
import { PerplexityLogo, FirecrawlLogo } from "@/components/intelligence/icons";
import {
  Factory,
  Globe,
  Layers,
  Search,
  Shuffle,
  Sparkles,
  Zap,
} from "lucide-react";
import type { MatchedUniverse, RouteReasonCode, Signal } from "./types";
import {
  ROUTE_REASON_LABELS,
  ROUTE_REASON_TOOLTIPS,
  THEME_LABELS,
  relativeTime,
} from "./types";

// ── Monitor type → icon ─────────────────────────────────────────────────────

const MONITOR_ICON = {
  SEARCH: Search,
  DOMAIN: Globe,
  API: Zap,
} as const;

function getMonitorType(signal: Signal): keyof typeof MONITOR_ICON {
  if (
    signal.monitor?.type === "DOMAIN" ||
    signal.searchContext?.startsWith("domain_group:")
  )
    return "DOMAIN";
  if (
    signal.monitor?.type === "API" ||
    signal.searchContext?.startsWith("market_movers:") ||
    signal.searchContext === "earnings_calendar"
  )
    return "API";
  return "SEARCH";
}

// ── Finding Detail Dialog ───────────────────────────────────────────────────

interface FindingDetailDialogProps {
  signal: Signal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FindingDetailDialog({
  signal,
  open,
  onOpenChange,
}: FindingDetailDialogProps) {
  if (!signal) return null;

  const monitorType = getMonitorType(signal);
  const MonitorIcon = MONITOR_ICON[monitorType];
  const query = signal.searchQuery ?? signal.headline;
  const usedPerplexity =
    !signal.searchTool || signal.searchTool === "PERPLEXITY_SONAR";
  const usedFirecrawl = !!signal.artifactId;

  const hasSources = signal.sourceUrls.length > 0;

  const hasUniverseTags =
    signal.sectors.length > 0 ||
    signal.industries.length > 0 ||
    signal.themes.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background sm:max-w-3xl">
        <TooltipProvider>
          {/* Search bar — query + tool provenance */}
          <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 min-w-0">
            <MonitorIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground/80 truncate flex-1 min-w-0">
              {query}
            </span>
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

          {/* Sources + timestamp — Sonar cites 1..N articles per signal; all
              are shown flush-left so the first favicon lines up with the
              title below. Timestamp sits at the right end. */}
          <div className="-ml-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
            {hasSources ? (
              signal.sourceUrls.map((url, i) => {
                const domain = extractDomain(url);
                const name = signal.sourceNames[i] ?? domain;
                return (
                  <a
                    key={`${url}-${i}`}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <Favicon domain={domain} size={14} />
                    <span>{name}</span>
                  </a>
                );
              })
            ) : null}
            <span className="ml-auto tabular-nums px-1.5">
              {relativeTime(signal.createdAt)}
            </span>
          </div>

          <DialogHeader>
            <DialogTitle>{signal.headline}</DialogTitle>
            <DialogDescription>{signal.summary}</DialogDescription>
          </DialogHeader>

          {/* Tickers — logo + chat-style live-price chip */}
          {signal.tickers.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {signal.tickers.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5"
                >
                  <StockLogo ticker={t} size="sm" className="h-5 w-5" />
                  <TickerChip symbol={t} />
                </span>
              ))}
            </div>
          )}

          {/* Universe tags — outline badges, icon + value, no row labels */}
          {hasUniverseTags && (
            <div className="flex flex-wrap gap-1">
              {signal.sectors.map((v) => (
                <UniverseBadge key={`sec-${v}`} icon={Layers} label={v} />
              ))}
              {signal.industries.map((v) => (
                <UniverseBadge key={`ind-${v}`} icon={Factory} label={v} />
              ))}
              {signal.themes.map((v) => (
                <UniverseBadge
                  key={`thm-${v}`}
                  icon={Sparkles}
                  label={humanizeTheme(v)}
                />
              ))}
            </div>
          )}

          {/* Routing — ButtonGroup per analyst */}
          {signal.routes && signal.routes.length > 0 && (
            <div className="border-t pt-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Shuffle className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Routed to
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {signal.routes.map((r) => (
                  <RouteGroup
                    key={r.id}
                    analystName={r.analyst.name}
                    code={r.routeReasonCode}
                    matched={r.matchedUniverse}
                    relevanceScore={r.relevanceScore}
                  />
                ))}
              </div>
            </div>
          )}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

// ── Universe badge ──────────────────────────────────────────────────────────
// Outline variant, muted icon + label. Reads as metadata.

function UniverseBadge({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Badge variant="outline" className="text-muted-foreground font-normal">
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </Badge>
  );
}

// ── Route group — analyst | category with tooltip ───────────────────────────

function RouteGroup({
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
  const categoryLabel = code ? ROUTE_REASON_LABELS[code] : "Legacy";
  const matchedValues = extractMatchedValues(matched);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ButtonGroup className="cursor-default">
            <Badge variant="secondary" className="rounded-r-none font-normal">
              {analystName}
            </Badge>
            <ButtonGroupSeparator />
            <Badge
              variant="secondary"
              className="rounded-l-none text-muted-foreground font-normal"
            >
              {categoryLabel}
            </Badge>
          </ButtonGroup>
        }
      />
      <TooltipContent side="bottom" className="max-w-xs text-xs space-y-1.5">
        <p className="leading-relaxed">
          {code
            ? ROUTE_REASON_TOOLTIPS[code]
            : "Routed before reason codes were tracked."}
        </p>
        {matchedValues.length > 0 && (
          <p className="text-muted-foreground">
            Matched: {matchedValues.join(", ")}
          </p>
        )}
        <p className="text-muted-foreground tabular-nums">
          Relevance {relevanceScore}
        </p>
      </TooltipContent>
    </Tooltip>
  );
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
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      </PopoverContent>
    </Popover>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractMatchedValues(m: MatchedUniverse | null): string[] {
  if (!m) return [];
  const out: string[] = [];
  if (m.sectors?.length) out.push(...m.sectors);
  if (m.industries?.length) out.push(...m.industries);
  if (m.themes?.length) out.push(...m.themes.map(humanizeTheme));
  if (m.inWatchlist) out.push("watchlist hit");
  if (m.inPositions) out.push("open position");
  return out;
}

/**
 * Themes are stored canonically as UPPERCASE_SNAKE_CASE. Map known themes to
 * their display labels, otherwise sentence-case the tokens.
 */
function humanizeTheme(raw: string): string {
  if (THEME_LABELS[raw]) return THEME_LABELS[raw];
  const words = raw.toLowerCase().replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
