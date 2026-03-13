"use client";

import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus, ExternalLink, TrendingUp, TrendingDown } from "lucide-react";
import { useEffect, useState, memo, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuoteData {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  prevClose: number;
}

// ─── Global quote cache (shared across all TickerChips in the session) ────────

const quoteCache = new Map<string, { data: QuoteData; fetchedAt: number }>();
const pendingFetches = new Map<string, Promise<QuoteData | null>>();
const CACHE_TTL_MS = 30_000; // 30s — matches Finnhub revalidate

async function fetchQuote(symbol: string): Promise<QuoteData | null> {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  // Deduplicate concurrent requests for the same symbol
  const pending = pendingFetches.get(symbol);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbol)}`);
      if (!res.ok) return null;
      const json = await res.json();
      const quote = json.quotes?.[0] as QuoteData | undefined;
      if (quote && quote.price > 0) {
        quoteCache.set(symbol, { data: quote, fetchedAt: Date.now() });
        return quote;
      }
      return null;
    } catch {
      return null;
    } finally {
      pendingFetches.delete(symbol);
    }
  })();

  pendingFetches.set(symbol, promise);
  return promise;
}

// ─── Direction helpers ────────────────────────────────────────────────────────

function directionColor(changePct: number) {
  if (changePct > 0.05) return "text-emerald-500";
  if (changePct < -0.05) return "text-red-500";
  return "text-muted-foreground";
}

function DirectionIcon({ changePct, className }: { changePct: number; className?: string }) {
  if (changePct > 0.05) return <ArrowUpRight className={cn("h-3 w-3", className)} />;
  if (changePct < -0.05) return <ArrowDownRight className={cn("h-3 w-3", className)} />;
  return <Minus className={cn("h-3 w-3", className)} />;
}

function TrendIcon({ changePct, className }: { changePct: number; className?: string }) {
  if (changePct > 0.05) return <TrendingUp className={cn("h-4 w-4 text-emerald-500", className)} />;
  if (changePct < -0.05) return <TrendingDown className={cn("h-4 w-4 text-red-500", className)} />;
  return <Minus className={cn("h-4 w-4 text-muted-foreground", className)} />;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toFixed(2);
}

function formatChange(change: number): string {
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${change.toFixed(2)}`;
}

function formatChangePct(pct: number): string {
  const prefix = pct > 0 ? "+" : "";
  return `${prefix}${pct.toFixed(2)}%`;
}

// ─── Inline TickerChip — Perplexity-style badge with hover card ──────────────

export const TickerChip = memo(function TickerChip({
  symbol,
}: {
  symbol: string;
}) {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchQuote(symbol.toUpperCase()).then((q) => {
      if (!cancelled) {
        setQuote(q);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [symbol]);

  const sym = symbol.toUpperCase();

  // Loading or no data — render a plain badge
  if (loading || !quote) {
    return (
      <Badge
        variant="secondary"
        className="cursor-default rounded-full px-1.5 py-0 text-[11px] font-semibold tabular-nums align-baseline mx-0.5 gap-0.5"
      >
        <span className="font-mono">${sym}</span>
      </Badge>
    );
  }

  const color = directionColor(quote.changePct);

  return (
    <HoverCard>
      <HoverCardTrigger
        openDelay={100}
        render={
          <Badge
            variant="secondary"
            className={cn(
              "cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums align-baseline mx-0.5 gap-1",
              "hover:bg-accent transition-colors inline-flex items-center",
            )}
          />
        }
      >
        <span className="font-semibold">{sym}</span>
        <span className={cn("inline-flex items-center gap-0.5", color)}>
          <DirectionIcon changePct={quote.changePct} className="h-2.5 w-2.5" />
          <span>{formatChangePct(quote.changePct)}</span>
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-64 p-0 overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2.5 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendIcon changePct={quote.changePct} />
              <div>
                <p className="text-sm font-semibold">{sym}</p>
              </div>
            </div>
            <a
              href={`https://finance.yahoo.com/quote/${sym}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* Price */}
        <div className="px-3 py-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-semibold tabular-nums">
              ${formatPrice(quote.price)}
            </span>
            <span className={cn("text-sm font-medium tabular-nums", color)}>
              {formatChange(quote.change)} ({formatChangePct(quote.changePct)})
            </span>
          </div>

          {/* Day range bar */}
          <div className="mt-2.5 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-wide">
              <span>Prev Close</span>
              <span>Current</span>
            </div>
            <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all",
                  quote.changePct >= 0 ? "bg-emerald-500/60" : "bg-red-500/60",
                )}
                style={{
                  width: `${Math.min(100, Math.max(5, 50 + quote.changePct * 5))}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
              <span>${formatPrice(quote.prevClose)}</span>
              <span className={color}>${formatPrice(quote.price)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t bg-muted/20 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">via Finnhub</span>
          <a
            href={`/stocks?symbol=${sym}`}
            className="text-[10px] text-primary hover:underline"
          >
            View in Hindsight →
          </a>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
});

// ─── Ticker parser ───────────────────────────────────────────────────────────
// Matches $AAPL, $TSLA, $SPY etc. in text. Won't match inside URLs or code.

const TICKER_PATTERN = /(?<!\w)\$([A-Z]{1,5})(?!\w)/g;

export type TickerSegment =
  | { type: "text"; value: string }
  | { type: "ticker"; symbol: string };

export function parseTickerMentions(text: string): TickerSegment[] {
  const segments: TickerSegment[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex
  TICKER_PATTERN.lastIndex = 0;

  while ((match = TICKER_PATTERN.exec(text)) !== null) {
    if (match.index > lastEnd) {
      segments.push({ type: "text", value: text.slice(lastEnd, match.index) });
    }
    segments.push({ type: "ticker", symbol: match[1] });
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < text.length) {
    segments.push({ type: "text", value: text.slice(lastEnd) });
  }

  return segments;
}

// ─── Batch fetcher for prefetching multiple tickers at once ──────────────────

export function usePrefetchTickers(symbols: string[]) {
  useEffect(() => {
    if (symbols.length === 0) return;
    // Batch fetch all unique symbols
    const unique = [...new Set(symbols.map(s => s.toUpperCase()))];
    const toFetch = unique.filter(s => {
      const cached = quoteCache.get(s);
      return !cached || Date.now() - cached.fetchedAt >= CACHE_TTL_MS;
    });
    if (toFetch.length === 0) return;

    // Use the batch endpoint
    fetch(`/api/quotes?symbols=${toFetch.join(",")}`)
      .then(r => r.json())
      .then(json => {
        for (const q of json.quotes ?? []) {
          if (q.price > 0) {
            quoteCache.set(q.symbol, { data: q, fetchedAt: Date.now() });
          }
        }
      })
      .catch(() => {});
  }, [symbols.join(",")]);
}
