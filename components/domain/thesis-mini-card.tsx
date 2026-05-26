"use client";

/**
 * ThesisMiniCard — compact thesis card for the agent chat carousel.
 *
 * Reads live state via useThesisCardData(thesis_id) — the same two
 * endpoints (/triggers + /quote) the open ThesisSheet uses. The card
 * and the sheet now share one source of truth: clicking a card never
 * shows different data than the card itself was already showing.
 *
 * Layout (top to bottom):
 *   • header   — logo + name + status pill
 *   • price    — live current price + day change (PriceChange)
 *   • holding  — "Holding N shares · avg entry $X" + P&L  (ACTIVE only)
 *   • gauge    — PriceGauge (stop · entry · target), the same one the
 *                sheet renders in its Price Targets block
 *   • belief   — coreBelief (3-line clamp). Falls back to snapshot text
 *                then to the pass_reason / reasoning_summary on prop
 *                for legacy theses with no V2 fields.
 *
 * Falls back gracefully to the prop snapshot when:
 *   • the thesis isn't persisted yet (agent rendering inline mid-run)
 *   • the /triggers fetch fails
 *
 * Click opens the same shared <ThesisSheet> as every other entry point.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChange } from "@/components/ui/price-change";
import { PriceGauge } from "@/components/ui/gauge";
import { ThesisSheet, type ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import { getThesisStatusDisplay } from "@/lib/thesis-status";
import { useThesisCardData } from "@/lib/hooks/use-thesis-card-data";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Trim trailing zeros on share quantity, keep up to 4 decimals. */
function fmtShares(n: number): string {
  const fixed = n.toFixed(4);
  return fixed.replace(/\.?0+$/, "");
}

// ── Card ────────────────────────────────────────────────────────────────────

export function ThesisMiniCard({ thesis }: { thesis: ThesisCardData }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { state, quote } = useThesisCardData(thesis.thesis_id ?? null);

  // Live state takes precedence; prop snapshot is the fallback for the
  // inline-during-run case and for /triggers errors.
  const status = state?.status ?? thesis.status;
  // TriggersResponse doesn't carry direction (it's static-at-write and the
  // sheet pulls it from the same row's parent props). Fall back to the
  // prop snapshot for direction-dependent rendering.
  const direction = thesis.direction;
  const entryPrice = state?.entryPrice ?? thesis.entry_price ?? null;
  const targetPrice = state?.targetPrice ?? thesis.target_price ?? null;
  const stopLoss = state?.stopLoss ?? thesis.stop_loss ?? null;
  const position = state?.position ?? null;
  const positionPnl = quote?.positionPnl ?? null;

  const statusDisplay = getThesisStatusDisplay(status);
  const isPass = direction === "PASS";
  const hasGauge = entryPrice != null && (targetPrice != null || stopLoss != null);
  const isHolding = status === "ACTIVE" && position != null;

  const belief =
    state?.coreBelief?.trim() ||
    state?.snapshot?.text?.trim() ||
    (isPass ? thesis.pass_reason : null) ||
    thesis.reasoning_summary ||
    null;

  return (
    <>
      <Card
        onClick={() => setSheetOpen(true)}
        className="p-3 gap-2 cursor-pointer hover:bg-accent/40 transition-colors h-full text-left"
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

        {/* ── Day price + change ──────────────────────────────────── */}
        {/* Live from /api/theses/:id/quote. Skeleton while loading,
            silent fail (no row) if Finnhub errors. */}
        {quote?.currentPrice != null ? (
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-lg font-semibold tabular-nums shrink-0">
              {fmtPrice(quote.currentPrice)}
            </span>
            {quote.dayChange != null && (
              <PriceChange
                dollarChange={quote.dayChange}
                percentChange={quote.dayChangePct}
                size="sm"
              />
            )}
          </div>
        ) : !state ? (
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ) : null}

        {/* ── Holding sentence (ACTIVE only) ──────────────────────── */}
        {/* Matches the format used on the trade detail page header so
            the holding row reads the same everywhere it appears. */}
        {isHolding && position && (
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="truncate">
              Holding {fmtShares(position.quantity)} sh · avg entry{" "}
              <span className="font-medium text-foreground tabular-nums">
                {fmtPrice(position.avgCost)}
              </span>
            </span>
            {positionPnl?.unrealizedPnl != null && (
              <PriceChange
                dollarChange={positionPnl.unrealizedPnl}
                percentChange={positionPnl.unrealizedPnlPct}
                size="sm"
                className="shrink-0"
              />
            )}
          </div>
        )}

        {/* ── Price gauge (stop · entry · target) ─────────────────── */}
        {/* Reuses the same PriceGauge primitive the sheet's Price
            Targets block renders, so the card and the sheet show the
            same visual for the same data. */}
        {hasGauge && (
          <div className="pt-1">
            <PriceGauge
              entry={entryPrice!}
              target={targetPrice}
              stop={stopLoss}
              current={quote?.currentPrice ?? null}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums mt-1">
              <span>{stopLoss != null ? `Stop ${fmtPrice(stopLoss)}` : ""}</span>
              <span>{targetPrice != null ? `Target ${fmtPrice(targetPrice)}` : ""}</span>
            </div>
          </div>
        )}

        {/* ── Core belief body ────────────────────────────────────── */}
        {belief && (
          <p className="text-sm text-muted-foreground line-clamp-3 leading-snug pt-1">
            {belief}
          </p>
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
