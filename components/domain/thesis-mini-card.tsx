"use client";

/**
 * ThesisMiniCard — the thesis card in the agent chat's carousel, the thesis
 * sheet in small (the owner, 2026-11-13). Top to bottom, each piece the
 * sheet's own:
 *   • the status pill
 *   • the stock row: logo, ticker, name (`StockRow`)
 *   • the live price and the day's move, one size
 *   • the position's line ("Holding 300 shares, $12,468.00 value") and its
 *     gain under it, the banner's two rows turned over so the day's move and
 *     the position's gain are not back to back
 *   • the belief, three lines
 *
 * It reads live state through useThesisCardData(thesis_id), the two
 * endpoints the open sheet uses, so the card and the sheet cannot disagree.
 * It falls back to the prop snapshot when the thesis is not saved yet (the
 * agent drawing it mid-run) or the read fails. A click opens the sheet.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PriceChange } from "@/components/ui/price-change";
import { StatusPill, StockRow } from "@/components/domain/thesis-header";
import { tradeLine } from "@/components/domain/trade-summary";
import { ThesisSheet, type ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import { agentWatchDays } from "@/lib/agent/triggers/agent-watch";
import { useThesisCardData } from "@/lib/hooks/use-thesis-card-data";
import { formatCurrency } from "@/lib/format";

export function ThesisMiniCard({ thesis }: { thesis: ThesisCardData }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { state, quote } = useThesisCardData(thesis.thesis_id ?? null);

  // Live state takes precedence; the prop snapshot is the fallback.
  const status = state?.status ?? thesis.status;
  const position = state?.position ?? null;
  const line = position
    ? tradeLine({
        position,
        pnl: quote?.positionPnl ?? null,
        pendingProposal: position.pendingProposal ?? null,
        direction: state?.direction === "SHORT" ? "SHORT" : state?.direction === "LONG" ? "LONG" : null,
        fills: state?.fills ?? [],
      })
    : null;

  const belief =
    state?.coreBelief?.trim() ||
    state?.snapshot?.text?.trim() ||
    (status === "PASSED" ? thesis.pass_reason : null) ||
    thesis.reasoning_summary ||
    null;

  return (
    <>
      <Card onClick={() => setSheetOpen(true)} className="p-3 gap-2 cursor-pointer hover:bg-accent/40 transition-colors h-full text-left">
        <div className="flex">
          <StatusPill status={status ?? ""} agentWatchDays={state ? agentWatchDays(state.triggers) : null} />
        </div>

        {/* The stock, as the sheet draws it; no links of its own, the card is the click. */}
        <StockRow ticker={thesis.ticker} displayName={thesis.company_name ?? quote?.companyName ?? thesis.ticker} href={null} />

        {/* The live price and the day's move, one size: the price in the text's color, the move in its own. */}
        {quote?.currentPrice != null ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg font-medium tabular-nums shrink-0">{formatCurrency(quote.currentPrice)}</span>
            {quote.dayChange != null ? <PriceChange dollarChange={quote.dayChange} percentChange={quote.dayChangePct} size="lg" /> : null}
          </div>
        ) : !state ? (
          <Skeleton className="h-7 w-32" />
        ) : null}

        {/* The position: its line, then its gain (dimmed once the trade is closed and the gain is final). */}
        {line ? (
          <div className="space-y-0.5">
            <p className="truncate text-sm tabular-nums">{line.sentence}</p>
            {line.gain ? (
              <div className={line.settled ? "opacity-60" : undefined}>
                <PriceChange dollarChange={line.gain.dollar} percentChange={line.gain.pct} size="sm" />
              </div>
            ) : null}
          </div>
        ) : null}

        {belief ? <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{belief}</p> : null}
      </Card>

      <ThesisSheet open={sheetOpen} onOpenChange={setSheetOpen} {...thesis} />
    </>
  );
}
