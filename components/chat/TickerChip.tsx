"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { StockLogo } from "@/components/StockLogo";
import { TradeRowShell, GainPair } from "@/components/ui/trade-row";
import { cn } from "@/lib/utils";
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
      {/* The card IS the app's stock row — the same TradeRowShell + GainPair
          the dashboard's pinned list and the coverage table use, so a stock
          looks the same wherever it appears. It used to be a bespoke layout
          with its own type scale, a "day range" gauge that was not a day range
          (it mapped the percent move onto ten blocks at roughly 1% each), and
          a "via Finnhub" footer that stopped being true when live prices moved
          to Alpaca. The row links to the stock, so the footer's link is gone
          with it. */}
      <HoverCardContent side="top" className="w-72 p-1">
        <TradeRowShell
          href={`/stocks/${sym}`}
          leading={<StockLogo ticker={sym} size="md" className="rounded-md" />}
          primary={<span className="text-sm font-medium">{sym}</span>}
          trailingTop={
            <span className="inline-flex items-center gap-1 text-sm tabular-nums font-light">
              ${formatPrice(quote.price)}
            </span>
          }
          trailingBottom={<GainPair dollar={quote.change} pct={quote.changePct} />}
        />
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

