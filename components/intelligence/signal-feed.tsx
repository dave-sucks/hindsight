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
import { TooltipProvider } from "@/components/ui/tooltip";
import { FindingDetailDialog } from "@/components/intelligence/finding-detail";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import { Search } from "lucide-react";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { cn } from "@/lib/utils";
import type { Signal } from "./types";
import { relativeTime } from "./types";
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
            signals.length === 0 ? (
              <SkeletonCardStack
                count={3}
                title="No findings yet"
                subtitle="Every morning, your analysts' monitors search the web, scan market movers, and extract domain sources. Findings appear here automatically."
              />
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No findings match your filters
              </p>
            )
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

        <FindingDetailDialog
          signal={selected}
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
        />
      </div>
    </TooltipProvider>
  );
}

// ── Signal Row ──────────────────────────────────────────────────────────────

export const SignalRow = memo(function SignalRow({
  signal,
  onSelect,
}: {
  signal: Signal;
  onSelect: (signal: Signal) => void;
}) {
  const primarySource = signal.sourceNames[0];
  const primaryDomain = extractDomainFromUrls(signal.sourceUrls);
  const sentimentDir = signal.sentiment === "BULLISH" ? "up" : signal.sentiment === "BEARISH" ? "down" : null;

  return (
    <Card
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelect(signal)}
    >
      <div className="space-y-2">
        {/* Row 1: headline left, ticker + arrow right */}
        <div className="flex items-start gap-3">
          <p className="text-sm font-medium leading-tight flex-1 min-w-0">
            {signal.headline}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {signal.tickers.length > 0 && (
              <span className="text-xs font-mono font-medium text-muted-foreground">
                {signal.tickers.length === 1
                  ? signal.tickers[0]
                  : signal.tickers.slice(0, 2).join(", ")
                }
                {signal.tickers.length > 2 && ` +${signal.tickers.length - 2}`}
              </span>
            )}
            {sentimentDir && (
              <PnlArrow direction={sentimentDir} className="h-4 w-4" />
            )}
          </div>
        </div>

        {/* Row 2: summary — text-sm for readability */}
        <p className="text-sm text-muted-foreground line-clamp-2">
          {signal.summary}
        </p>

        {/* Row 3: source logo + name, then timestamp */}
        <div className="flex items-center gap-1.5">
          {primaryDomain && (
            <Favicon domain={primaryDomain} />
          )}
          {primarySource && (
            <span className="text-xs text-muted-foreground">{primarySource}</span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums ml-auto shrink-0">
            {relativeTime(signal.createdAt)}
          </span>
        </div>
      </div>
    </Card>
  );
});


// ── Favicon ──────────────────────────────────────────────────────────────────
// Uses Google's favicon service for any domain.

export function Favicon({ domain, size = 16 }: { domain: string; size?: number }) {
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

/** Extract a domain from source URLs */
function extractDomainFromUrls(urls: string[]): string | null {
  for (const url of urls) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { /* skip */ }
  }
  return null;
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
                    isPositive ? "text-positive" : "text-negative"
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

