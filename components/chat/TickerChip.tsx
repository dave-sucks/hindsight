"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { cn, pnlColor } from "@/lib/utils";
import { useEffect, useState, memo } from "react";
import {
  fetchQuote,
  usePrefetchTickers,
  type QuoteData,
} from "@/hooks/useTickerQuote";

// The quote cache + fetch path now live in @/hooks/useTickerQuote (one shared
// source behind every price/day-change surface). Re-exported here so existing
// importers (ticker-markdown) keep working unchanged.
export { usePrefetchTickers };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toFixed(2);
}

// ─── Day range gauge — 10 small rectangles ───────────────────────────────────

function DayRangeGauge({
  prevClose,
  current,
}: {
  prevClose: number;
  current: number;
}) {
  const changePct = prevClose > 0 ? ((current - prevClose) / prevClose) * 100 : 0;
  // Map change percentage to filled blocks (0-10)
  // Each block ≈ 1% move. Center is 5 blocks (0% change).
  const filled = Math.min(10, Math.max(0, Math.round(5 + changePct * 2)));
  const isPositive = changePct >= 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="tabular-nums">${formatPrice(prevClose)}</span>
        <span className={cn("tabular-nums", isPositive ? "text-positive" : "text-negative")}>
          ${formatPrice(current)}
        </span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-[1px]",
              i < filled
                ? isPositive
                  ? "bg-positive/60"
                  : "bg-negative/60"
                : "bg-muted",
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Inline TickerChip — Perplexity-style inline text with hover card ────────

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

  // Loading or no data — render plain text
  if (loading || !quote) {
    return (
      <span className="font-mono font-medium text-foreground mx-0.5">
        ${sym}
      </span>
    );
  }

  const isPositive = quote.changePct >= 0;

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <span className="cursor-pointer inline-flex items-center gap-1 mx-0.5 align-baseline" />
        }
      >
        <span className="font-mono font-medium text-foreground">${sym}</span>
        <span
          className={cn(
            "inline-flex items-center rounded-md px-1.5 py-0 text-xs font-medium tabular-nums",
            isPositive
              ? "bg-positive/10 text-positive"
              : "bg-negative/10 text-negative",
          )}
        >
          {isPositive ? "↗" : "↘"} {isPositive ? "+" : ""}{quote.changePct.toFixed(2)}%
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-64 p-0 overflow-hidden">
        {/* Main row: logo + name/ticker + price */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          <StockLogo ticker={sym} size="md" className="rounded-md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{sym}</p>
              </div>
              <span className="text-sm font-medium tabular-nums shrink-0">
                ${formatPrice(quote.price)}
              </span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[10px] text-muted-foreground font-mono">${sym}</span>
              <div className="flex items-center gap-1.5">
                <span className={cn("text-xs tabular-nums", pnlColor(quote.change))}>
                  {quote.change >= 0 ? "+" : ""}{quote.change.toFixed(2)}
                </span>
                <PnlBadge value={quote.changePct} format="percent" className="text-[10px]" />
              </div>
            </div>
          </div>
        </div>

        {/* Day range gauge */}
        <div className="px-3 pb-2.5">
          <DayRangeGauge prevClose={quote.prevClose} current={quote.price} />
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

