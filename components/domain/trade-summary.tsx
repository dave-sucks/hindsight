"use client";

/**
 * TradeSummary — the ONE trade section, in two looks.
 *
 * The thesis sheet and the trade page read the same position (the dossier's)
 * and the same live P&L (the quote's), so the numbers can't drift between
 * them. What differs is the look:
 *
 *   • "banner" — the muted card under the price that opens the trade: one
 *     sentence with the date and the gain, a waiting proposal's line and
 *     Review above it, its reason under it. The sheet shows it in every state; the page shows it only
 *     while a proposal waits (the card carries the held numbers there).
 *   • "card"   — the page's right-hand position card: status pill and days
 *     held, the gain in the header's PriceChange, then Bought / Sold / Now /
 *     Exit rows in the Trade Details style. Nothing while a buy is only
 *     proposed — no shares exist yet.
 *
 * The card builds its own lines; the rows keep the SHARED buildTradeSentence and the
 * SHARED <TradeStatement>; this file only picks per-state inputs.
 */

import { getThesisStatusDisplay } from "@/lib/thesis-status";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PriceChange } from "@/components/ui/price-change";
import { ProposalNote } from "@/components/domain/proposal-note";
import { SectionLabel } from "@/components/domain/section-label";
import type { TradeStatementGain } from "@/components/ui/trade-statement";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtQty } from "@/lib/trade-statement";
import { EXECUTING_LABEL, EXECUTING_TOOLTIP, getTradeStatusDisplay } from "@/lib/trade-status";
import { formatCurrency } from "@/lib/format";
import type { ThesisPendingProposal, ThesisStatePosition } from "@/lib/types/thesis-sheet";

export type TradeSummaryPnl = {
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number | null;
} | null;

export type TradeSummaryProps = {
  look: "banner" | "card";
  position: ThesisStatePosition;
  pnl: TradeSummaryPnl;
  pendingProposal: ThesisPendingProposal | null;
  direction: "LONG" | "SHORT" | null;
};

/** Compact "Jun 2" date for the meta line. */
export function fmtTradeDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Close reason from close_position is an enum (TARGET / STOP / MANUAL) or
 * PROMOTED from the promote action — sometimes with " — {notes}" appended.
 * Rendering "STOP" raw read as a broken label; humanize the known codes and
 * pass through anything that's already a sentence.
 */
export function humanizeCloseReason(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const [head, ...rest] = raw.split(" — ");
  const map: Record<string, string> = {
    STOP: "Stopped out",
    TARGET: "Hit target",
    MANUAL: "Closed manually",
    PROMOTED: "Closed on promotion to live",
  };
  const mapped = map[head.trim().toUpperCase()];
  if (mapped) return rest.length ? `${mapped} — ${rest.join(" — ")}` : mapped;
  return raw;
}

export function TradeSummary(props: TradeSummaryProps) {
  return props.look === "card" ? <TradeCard {...props} /> : <TradeBanner {...props} />;
}

// ── The banner ──
// One card for every state (the owner's rule, 2026-11-04): a bordered,
// muted card that opens the trade, one sentence with the date and the gain
// on the right. A waiting proposal gets a small mono PROPOSAL label at the
// top left and Review at the far right, and leads the sentence with its verb in medium weight; the amber dot says
// "waiting", so the word "Proposed" is gone. The reason sits under it, two
// lines until clicked.
//   • holding          → "Bought N shares at $entry on Oct 5"
//   • closed           → "Sold N shares at $close on Nov 19"
//   • held + pending   → "Sell: Bought N shares at $entry on Oct 5"
//   • pending buy      → "Buy N shares at $entry on Nov 19"
function TradeBanner({ position, pnl, pendingProposal, direction }: TradeSummaryProps) {
  const pp = pendingProposal;
  const usd = (n: number) => formatCurrency(n);
  const shares = (n: number) => `${fmtQty(n)} ${n === 1 ? "share" : "shares"}`;
  const unrealized: TradeStatementGain | null = pnl ? { dollar: pnl.unrealizedPnl, pct: pnl.unrealizedPnlPct } : null;
  const bought = `Bought ${shares(position.quantity)} at ${usd(position.avgCost)} on ${fmtTradeDate(position.openedAt)}`;

  let lead: string | null = null;
  let rest: string;
  let gain: TradeStatementGain | null = null;
  let dotClass = "bg-muted-foreground/40";

  // Review while the decision is yours; "Executing" once the order is at Alpaca.
  let reviewSlot: ReactNode = null;
  if (pp?.executing) {
    reviewSlot = (
      <Tooltip>
        <TooltipTrigger render={<span className="text-xs shimmer-text cursor-default" />}>
          {EXECUTING_LABEL}
        </TooltipTrigger>
        <TooltipContent className="text-xs">{EXECUTING_TOOLTIP}</TooltipContent>
      </Tooltip>
    );
  } else if (pp) {
    reviewSlot = <ProposalActions orderId={pp.orderId} expiresAt={pp.expiresAt} align="end" />;
  }

  if (pp && pp.intent === "OPEN") {
    lead = direction === "SHORT" ? "Short" : "Buy";
    rest = ` ${shares(pp.quantity)} at ${usd(position.avgCost)} on ${fmtTradeDate(position.openedAt)}`;
    dotClass = getTradeStatusDisplay(pp.executing ? "OPEN" : "PENDING").dotClass;
  } else if (pp) {
    lead = `${pp.intent === "ADD" ? "Add" : pp.intent === "CLOSE" ? "Sell" : "Trim"}:`;
    rest = ` ${bought}`;
    dotClass = getTradeStatusDisplay(pp.executing ? "OPEN" : "PENDING").dotClass;
    gain = unrealized;
  } else if (position.closed) {
    rest =
      `Sold ${shares(position.quantity)}` +
      (position.closePrice != null ? ` at ${usd(position.closePrice)}` : "") +
      (position.closedAt ? ` on ${fmtTradeDate(position.closedAt)}` : "");
    if (position.realizedPnl != null) gain = { dollar: position.realizedPnl, pct: position.realizedPnlPct ?? 0 };
  } else {
    rest = bought;
    dotClass = getThesisStatusDisplay("HOLDING").dotClass;
    gain = unrealized;
  }

  // Outline only; a background on hover. The click opens the trade, except on
  // a waiting proposal, where it expands the reason instead.
  const proposal = Boolean(pp && !pp.executing);
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={cn("relative rounded-lg border px-4 py-3 space-y-1.5 transition-colors hover:bg-muted/40", proposal && "cursor-pointer")}
      onClick={proposal ? () => setExpanded((v) => !v) : undefined}
    >
      {/* The whole card opens the trade: a stretched link under the content, never a link around the controls. */}
      {position.id && !proposal ? (
        <Link href={`/trades/${position.id}`} aria-label="Open the trade" className="absolute inset-0 rounded-lg" />
      ) : null}
      {/* The label and the reason start where the sentence's text starts: past the dot (8px) and its gap (6px). */}
      {reviewSlot ? (
        <div className="relative flex items-center gap-3 pl-[14px]">
          <SectionLabel>Proposal</SectionLabel>
          <span className="ml-auto flex items-center" onClick={(e) => e.stopPropagation()}>{reviewSlot}</span>
        </div>
      ) : null}
      <div className="relative flex items-center justify-between gap-3 pointer-events-none">
        <div className="flex items-center gap-1.5 min-w-0 text-sm">
          <span className={cn("size-2 rounded-full shrink-0", dotClass)} />
          <span className="font-normal tabular-nums truncate">
            {lead ? <span className="font-medium">{lead}</span> : null}
            {rest}
          </span>
        </div>
        {gain ? <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="sm" className="shrink-0" /> : null}
      </div>
      {pp && !pp.executing ? (
        <div className="relative pl-[14px]">
          <ProposalNote orderId={pp.orderId} reason={pp.rationale} writing={pp.writing ?? false} expanded={expanded} />
        </div>
      ) : null}
    </div>
  );
}

// ── The card ──
// The page's position summary: the result once closed, the live position
// while held. Same frame as the stock cards; the gain is the header's
// PriceChange; the status is the app's pill.
function TradeCard({ position, pnl, pendingProposal }: TradeSummaryProps) {
  // A proposed buy holds no shares yet — nothing to summarise.
  if (pendingProposal?.intent === "OPEN" && !position.closed) return null;
  const closed = position.closed === true;
  if (!closed && pnl == null) return null;

  const cost = position.avgCost * position.quantity;
  const gain = closed ? (position.realizedPnl ?? 0) : pnl!.unrealizedPnl;
  const gainPct = closed
    ? (position.realizedPnlPct ?? (cost > 0 ? (gain / cost) * 100 : 0))
    : (pnl!.unrealizedPnlPct ?? 0);
  const status = getTradeStatusDisplay(
    !closed
      ? "OPEN"
      : position.outcome === "WIN"
        ? "CLOSED_WIN"
        : position.outcome === "LOSS"
          ? "CLOSED_LOSS"
          : "CLOSED_EXPIRED",
  );
  const exit = humanizeCloseReason(position.closeReason);

  return (
    <Card className="bg-muted/40 p-2 gap-1">
      <div className="flex items-center justify-between pb-1">
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", status.dotClass)} />
          {status.label}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {position.daysHeld} day{position.daysHeld !== 1 ? "s" : ""} held
        </span>
      </div>
      <div className="pb-2">
        <PriceChange dollarChange={gain} percentChange={gainPct} size="xl" />
      </div>
      <div className="flex items-center justify-between text-sm border-b border-border pb-1">
        <span className="text-muted-foreground">Bought @ {formatCurrency(position.avgCost)}</span>
        <span className="font-medium tabular-nums">{formatCurrency(cost)}</span>
      </div>
      {closed && position.closePrice != null ? (
        <div className="flex items-center justify-between text-sm border-b border-border pb-1">
          <span className="text-muted-foreground">Sold @ {formatCurrency(position.closePrice)}</span>
          <span className="font-medium tabular-nums">
            {formatCurrency(position.closePrice * position.quantity)}
          </span>
        </div>
      ) : null}
      {!closed && pnl ? (
        <div className="flex items-center justify-between text-sm border-b border-border pb-1">
          <span className="text-muted-foreground">Now @ {formatCurrency(pnl.currentPrice)}</span>
          <span className="font-medium tabular-nums">{formatCurrency(pnl.marketValue)}</span>
        </div>
      ) : null}
      {exit ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Exit</span>
          <span className="font-medium">{exit}</span>
        </div>
      ) : null}
    </Card>
  );
}
