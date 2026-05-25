"use client";

/**
 * ThesisMiniCard — compact thesis card for the agent chat carousel.
 *
 * Visual style mirrors components/intelligence/brief-card.tsx (white card,
 * border, p-3) and uses Polymarket-style price rows for Entry / Target /
 * Stop with a percentage delta badge to the right.
 *
 * Click → opens the single shared <ThesisSheet> (floating xl variant) —
 * the same sheet ThesisRow opens on Trades / Stocks / Watchlist. One
 * sheet design, one entry point.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";
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

function pctDelta(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

// ── Row ─────────────────────────────────────────────────────────────────────

function PriceRow({
  label,
  price,
  delta,
}: {
  label: string;
  price: number | null | undefined;
  delta: number | null;
}) {
  const positive = delta != null && delta >= 0;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 tabular-nums">
        {delta != null && (
          <Badge
            variant="secondary"
            className={cn(
              "font-normal",
              positive ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative",
            )}
          >
            {fmtPct(delta)}
          </Badge>
        )}
        <span className="text-foreground">{fmtPrice(price)}</span>
      </div>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

export function ThesisMiniCard({ thesis }: { thesis: ThesisCardData }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const statusDisplay = getThesisStatusDisplay(thesis.status);
  const targetDelta = pctDelta(thesis.entry_price, thesis.target_price);
  const stopDelta = pctDelta(thesis.entry_price, thesis.stop_loss);

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

        {/* ── Polymarket-style price rows ──────────────────────────── */}
        <div className="flex flex-col gap-1 pt-1">
          <PriceRow label="Entry" price={thesis.entry_price} delta={null} />
          <PriceRow label="Target" price={thesis.target_price} delta={targetDelta} />
          <PriceRow label="Stop" price={thesis.stop_loss} delta={stopDelta} />
        </div>

        {/* ── Reasoning summary ─────────────────────────────────────── */}
        {thesis.reasoning_summary && (
          <p className="text-sm text-muted-foreground line-clamp-3 leading-snug pt-1">
            {thesis.reasoning_summary}
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
