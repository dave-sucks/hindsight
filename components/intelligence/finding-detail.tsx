"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { StockLogo } from "@/components/StockLogo";
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
import { Factory, Layers, Sparkles } from "lucide-react";
import type { MatchedUniverse, RouteReasonCode, Signal } from "./types";
import {
  ROUTE_REASON_LABELS,
  ROUTE_REASON_TOOLTIPS,
  THEME_LABELS,
  relativeTime,
} from "./types";

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

  const primaryUrl = signal.sourceUrls[0] ?? null;
  const primaryName =
    signal.sourceNames[0] ??
    (primaryUrl ? extractDomain(primaryUrl) : "Unknown source");
  const primaryDomain = primaryUrl ? extractDomain(primaryUrl) : null;
  const additionalSources = signal.sourceUrls.slice(1);

  const hasUniverseTags =
    signal.sectors.length > 0 ||
    signal.industries.length > 0 ||
    signal.themes.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background sm:max-w-3xl">
        <TooltipProvider>
          {/* Source + timestamp — flush-left with negative margin so the
              favicon lines up with the title below */}
          {primaryUrl ? (
            <a
              href={primaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="-ml-1.5 inline-flex w-fit items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {primaryDomain && <Favicon domain={primaryDomain} size={14} />}
              <span>{primaryName}</span>
              <span>·</span>
              <span className="tabular-nums">
                {relativeTime(signal.createdAt)}
              </span>
            </a>
          ) : (
            <p className="text-xs text-muted-foreground tabular-nums">
              {relativeTime(signal.createdAt)}
            </p>
          )}

          <DialogHeader>
            <DialogTitle>{signal.headline}</DialogTitle>
            <DialogDescription>{signal.summary}</DialogDescription>
          </DialogHeader>

          {/* Tickers — below title, smaller logos */}
          {signal.tickers.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {signal.tickers.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5"
                >
                  <StockLogo ticker={t} size="sm" className="h-5 w-5" />
                  <span className="text-sm font-brand font-bold">{t}</span>
                </span>
              ))}
            </div>
          )}

          {/* Universe tags — icon + value, no row labels, muted */}
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

          {/* Additional sources — if more than one */}
          {additionalSources.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {additionalSources.map((url, i) => {
                const domain = extractDomain(url);
                const name = signal.sourceNames[i + 1] ?? domain;
                return (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {domain && <Favicon domain={domain} size={14} />}
                    <span>{name}</span>
                  </a>
                );
              })}
            </div>
          )}

          {/* Routing — ButtonGroup per analyst */}
          {signal.routes && signal.routes.length > 0 && (
            <div className="border-t pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Routed to
              </p>
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
// Icon on the left, label on the right. Secondary variant with foreground
// opacity dimmed so the tags read as metadata, not primary content.

function UniverseBadge({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Badge variant="secondary" className="text-muted-foreground font-normal">
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
            <Badge variant="outline" className="rounded-r-none font-normal">
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
