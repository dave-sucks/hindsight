"use client";

/**
 * ThesisMiniCard — compact thesis card for the agent chat carousel.
 *
 * Layout (top to bottom, fits a ~320px carousel slot):
 *
 *   [logo] Name                       [status pill]
 *   $157.47  +$3.91  ↗ 4.67%               [8/10]
 *
 *   (core belief — 2-3 lines, the durable claim)
 *
 *   Entry   $157.47
 *   Target  $175.00      (positive color)
 *   Stop    $149.00      (negative color)
 *
 * Live current price + day change come from /api/quotes (same endpoint
 * the ticker chip uses). One fetch per card on mount — at 5-7 cards in
 * a typical carousel this is fine, and Next caches at the route layer
 * with revalidate: 30 so repeated mounts hit the cache.
 *
 * Click opens the same shared <ThesisSheet> as every other entry point.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { ThesisSheet, type ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import { getThesisStatusDisplay } from "@/lib/thesis-status";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtSignedDollar(n: number): string {
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n >= 0 ? "+" : "-"}$${abs}`;
}

function fmtSignedPct(n: number): string {
  return `${Math.abs(n).toFixed(2)}%`;
}

/**
 * Composite badge variant — matches AnalystVerdictBadge on the sheet so
 * conviction reads identically across surfaces. confidence_score on
 * ThesisCardData is the 0-100 legacy scale (composite × 10), so we
 * divide back out.
 */
function compositeVariant(
  scoreOutOf10: number,
): "positive" | "secondary" | "negative" {
  if (scoreOutOf10 >= 7) return "positive";
  if (scoreOutOf10 >= 4) return "secondary";
  return "negative";
}

// ── Quote fetch ─────────────────────────────────────────────────────────────

type QuoteState = {
  price: number;
  change: number;
  changePct: number;
} | null;

function useTickerQuote(ticker: string): { quote: QuoteState; loading: boolean } {
  const [quote, setQuote] = useState<QuoteState>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/quotes?symbols=${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const q = json?.quotes?.[0];
        if (q && typeof q.price === "number" && q.price > 0) {
          setQuote({ price: q.price, change: q.change ?? 0, changePct: q.changePct ?? 0 });
        }
      })
      .catch(() => {
        /* non-fatal — card hides the price row */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return { quote, loading };
}

// ── Row primitive ───────────────────────────────────────────────────────────

function LevelRow({
  label,
  price,
  priceClass,
}: {
  label: string;
  price: number | null | undefined;
  priceClass?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums font-medium", priceClass)}>
        {fmtPrice(price)}
      </span>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

export function ThesisMiniCard({ thesis }: { thesis: ThesisCardData }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { quote, loading: quoteLoading } = useTickerQuote(thesis.ticker);
  const statusDisplay = getThesisStatusDisplay(thesis.status);

  const isPass = thesis.direction === "PASS";
  const hasEntry = thesis.entry_price != null;
  const hasTarget = thesis.target_price != null;
  const hasStop = thesis.stop_loss != null;

  const compositeOutOf10 =
    thesis.confidence_score > 0
      ? Math.round((thesis.confidence_score / 10) * 10) / 10
      : null;

  // Prefer the durable coreBelief over current-state reasoning_summary.
  // PASS theses fall back to pass_reason (they don't carry a coreBelief).
  const body =
    thesis.core_belief?.trim() ||
    (isPass ? thesis.pass_reason : null) ||
    thesis.reasoning_summary ||
    null;

  const changePositive = quote != null && quote.change >= 0;

  return (
    <>
      <Card
        onClick={() => setSheetOpen(true)}
        className="p-3 gap-3 cursor-pointer hover:bg-accent/40 transition-colors h-full text-left"
      >
        {/* ── Header: logo + name + status pill ───────────────────── */}
        <div className="flex items-center gap-2">
          <StockLogo ticker={thesis.ticker} size="sm" />
          <span className="text-sm font-semibold truncate">
            {thesis.company_name ?? thesis.ticker}
          </span>
          <Badge
            variant="secondary"
            className="ml-auto font-normal shrink-0 gap-1.5"
          >
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDisplay.dotClass)} />
            {statusDisplay.label}
          </Badge>
        </div>

        {/* ── Live price + day change + composite badge ───────────── */}
        <div className="flex items-baseline justify-between gap-2">
          {quote ? (
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-lg font-semibold tabular-nums shrink-0">
                {fmtPrice(quote.price)}
              </span>
              {quote.change !== 0 || quote.changePct !== 0 ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs tabular-nums shrink-0",
                    changePositive ? "text-positive" : "text-negative",
                  )}
                >
                  <span>{fmtSignedDollar(quote.change)}</span>
                  {changePositive ? (
                    <ArrowUpRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 shrink-0" />
                  )}
                  <span>{fmtSignedPct(quote.changePct)}</span>
                </span>
              ) : null}
            </div>
          ) : quoteLoading ? (
            <Skeleton className="h-6 w-32" />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
          {compositeOutOf10 != null && (
            <Badge
              variant={compositeVariant(compositeOutOf10)}
              className="font-normal tabular-nums shrink-0"
            >
              {compositeOutOf10}/10
            </Badge>
          )}
        </div>

        {/* ── Body: coreBelief (or fallback) ─────────────────────── */}
        {body && (
          <p className="text-sm text-foreground line-clamp-3 leading-snug">
            {body}
          </p>
        )}

        {/* ── Levels: Entry / Target / Stop stacked ──────────────── */}
        {(hasEntry || hasTarget || hasStop) && (
          <div className="flex flex-col gap-1 pt-0.5">
            {hasEntry && (
              <LevelRow label="Entry" price={thesis.entry_price} />
            )}
            {hasTarget && (
              <LevelRow
                label="Target"
                price={thesis.target_price}
                priceClass="text-positive"
              />
            )}
            {hasStop && (
              <LevelRow
                label="Stop"
                price={thesis.stop_loss}
                priceClass="text-negative"
              />
            )}
          </div>
        )}
      </Card>

      <ThesisSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        {...thesis}
      />
    </>
  );
}
