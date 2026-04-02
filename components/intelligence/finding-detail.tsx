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
import { TickerBadge } from "@/components/ui/ticker-badge";
import { AnalystBadge } from "@/components/ui/analyst-badge";
import { Favicon } from "@/components/intelligence/signal-feed";
import { PerplexityLogo, FirecrawlLogo } from "@/components/intelligence/icons";
import type { Signal } from "./types";
import { relativeTime } from "./types";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background sm:max-w-3xl">
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

        {/* Footer: analysts + timestamp */}
        <div className="border-t pt-3 space-y-2">
          {signal.routes && signal.routes.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Shared with</span>
                <Shuffle className="h-3 w-3" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {signal.routes.map((r) => (
                  <AnalystBadge key={r.id} name={r.analyst.name} icon={<Scan className="h-3 w-3" />} />
                ))}
                <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                  {relativeTime(signal.createdAt)}
                </span>
              </div>
            </>
          )}
          {(!signal.routes || signal.routes.length === 0) && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {relativeTime(signal.createdAt)}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </PopoverContent>
    </Popover>
  );
}
