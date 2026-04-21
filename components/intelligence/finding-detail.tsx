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
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Favicon } from "@/components/intelligence/signal-feed";
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
import { PerplexityLogo, FirecrawlLogo, EmailIcon } from "@/components/intelligence/icons";
import { Globe, Search, Shuffle, Zap } from "lucide-react";
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
  EMAIL: EmailIcon,
} as const;

function getMonitorType(signal: Signal): keyof typeof MONITOR_ICON {
  if (signal.searchTool === "EMAIL_INGEST") return "EMAIL";
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

/** Pull "<subject>" out of searchContext which the email-ingest route stores
 *  as "Inbound email: <subject>". Returns null if not an email signal. */
function emailSubject(signal: Signal): string | null {
  if (signal.searchTool !== "EMAIL_INGEST") return null;
  const ctx = signal.searchContext ?? "";
  const prefix = "Inbound email: ";
  return ctx.startsWith(prefix) ? ctx.slice(prefix.length) : null;
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
  const isEmail = monitorType === "EMAIL";
  const subject = emailSubject(signal);
  // Prefer the email subject line for email signals; fall back to the stored
  // search query, then the headline.
  const query = subject ?? signal.searchQuery ?? signal.headline;
  const usedPerplexity =
    !isEmail && (!signal.searchTool || signal.searchTool === "PERPLEXITY_SONAR");
  const usedFirecrawl = !!signal.artifactId;

  const hasSources = signal.sourceUrls.length > 0;

  const tagLine = [
    ...signal.sectors,
    ...signal.industries,
    ...signal.themes.map((t) => t.replace(/_/g, " ")),
  ].join(", ");

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

          {/* Sources + timestamp — Sonar cites 1..N articles per signal.
              Single source renders as a favicon + name link; multiple
              sources render as stacked avatars with a tooltip per one. */}
          {hasSources && (
            <div className="flex items-center gap-2">
              {signal.sourceUrls.length > 1 ? (
                <div className="flex -space-x-2">
                  {signal.sourceUrls.map((url, i) => {
                    const domain = extractDomain(url);
                    const name = signal.sourceNames[i] ?? domain;
                    return (
                      <Tooltip key={`${url}-${i}`}>
                        <TooltipTrigger
                          render={
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={name}
                            />
                          }
                        >
                          <Avatar size="sm" className="ring-2 ring-background">
                            <AvatarImage
                              src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`}
                              alt={name}
                            />
                            <AvatarFallback>
                              {name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{name}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ) : (
                (() => {
                  const url = signal.sourceUrls[0];
                  const domain = extractDomain(url);
                  const name = signal.sourceNames[0] ?? domain;
                  return (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="-ml-1.5 inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      {isEmail ? (
                        <EmailIcon className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Favicon domain={domain} size={14} />
                      )}
                      <span>{name}</span>
                    </a>
                  );
                })()
              )}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {relativeTime(signal.createdAt)}
              </span>
            </div>
          )}

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
                  />
                ))}
              </div>
            </div>
          )}

          {/* Tags — very bottom, comma-separated, uppercase mono xs muted */}
          {tagLine && (
            <p className="text-xs font-mono uppercase text-muted-foreground pt-1">
              {tagLine}
            </p>
          )}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

// ── Route group — analyst | category with tooltip ───────────────────────────

function RouteGroup({
  analystName,
  code,
  matched,
}: {
  analystName: string;
  code: RouteReasonCode | null;
  matched: MatchedUniverse | null;
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
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="flex flex-col gap-1.5 text-xs">
          <p className="leading-relaxed">
            {code
              ? ROUTE_REASON_TOOLTIPS[code]
              : "Routed before reason codes were tracked."}
          </p>
          {matchedValues.length > 0 && (
            <p className="opacity-70">Matched: {matchedValues.join(", ")}</p>
          )}
        </div>
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
  if (m.themes?.length) out.push(...m.themes.map((t) => t.replace(/_/g, " ")));
  if (m.inWatchlist) out.push("watchlist hit");
  if (m.inPositions) out.push("open position");
  return out;
}
