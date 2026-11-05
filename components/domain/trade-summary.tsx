"use client";

/**
 * TradeSummary — the ONE trade section, in two looks.
 *
 * The thesis sheet and the trade page read the same position (the dossier's)
 * and the same live P&L (the quote's), so the numbers can't drift between
 * them. What differs is the look:
 *
 *   • "banner" — the muted card under the price that opens the trade: a
 *     title row with a coloured dot (Proposal / Position / Closed position,
 *     Review at its right while a proposal waits), the sentence with the
 *     date and the gain, and a waiting proposal's reason under it. The sheet
 *     shows it in every state; the page shows it only while a proposal waits
 *     (the card carries the held numbers there).
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
import { HugeiconsIcon } from "@hugeicons/react";
import { ExpandIcon } from "@hugeicons/core-free-icons";
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
// One card for every state, two rows at least (the owner's rule, 2026-11-04,
// finalised the same night): the stock cards' surface (muted, bordered), a
// title row like the Triggers and Agent insights headings with a coloured
// dot where their icon sits, then the sentence, left-aligned, with the gain
// on its right. A waiting proposal's reason is hidden until asked for: on
// hover the title row turns into "Read reasoning" with an expand icon (the
// dot's place), and the click opens it; "Hide reasoning" closes it.
//   • proposal waiting → amber dot · "Proposal" · Review at the right
//                        "Add 4 shares: Bought N shares at $entry on Oct 5" / "Buy N shares at $entry on Nov 19"
//   • holding          → blue dot · "Position" · "Bought N shares at $entry on Oct 5"
//   • closed           → green or red dot by the result · "Closed position" · "Sold N shares at $close on Nov 19"
function TradeBanner({ position, pnl, pendingProposal, direction }: TradeSummaryProps) {
  const pp = pendingProposal;
  const usd = (n: number) => formatCurrency(n);
  const shares = (n: number) => `${fmtQty(n)} ${n === 1 ? "share" : "shares"}`;
  const unrealized: TradeStatementGain | null = pnl ? { dollar: pnl.unrealizedPnl, pct: pnl.unrealizedPnlPct } : null;
  const bought = `Bought ${shares(position.quantity)} at ${usd(position.avgCost)} on ${fmtTradeDate(position.openedAt)}`;

  let lead: string | null = null;
  let rest: string;
  let gain: TradeStatementGain | null = null;
  let title: string;
  let dotClass: string;

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
    title = "Proposal";
    dotClass = getTradeStatusDisplay(pp.executing ? "OPEN" : "PENDING").dotClass;
  } else if (pp) {
    // The verb carries the proposal's own size: "Add 4 shares:" before the position it adds to.
    lead = `${pp.intent === "ADD" ? "Add" : pp.intent === "CLOSE" ? "Sell" : "Trim"} ${shares(pp.quantity)}:`;
    rest = ` ${bought}`;
    title = "Proposal";
    dotClass = getTradeStatusDisplay(pp.executing ? "OPEN" : "PENDING").dotClass;
    gain = unrealized;
  } else if (position.closed) {
    rest =
      `Sold ${shares(position.quantity)}` +
      (position.closePrice != null ? ` at ${usd(position.closePrice)}` : "") +
      (position.closedAt ? ` on ${fmtTradeDate(position.closedAt)}` : "");
    if (position.realizedPnl != null) gain = { dollar: position.realizedPnl, pct: position.realizedPnlPct ?? 0 };
    title = "Closed position";
    dotClass = getTradeStatusDisplay((position.realizedPnl ?? 0) >= 0 ? "CLOSED_WIN" : "CLOSED_LOSS").dotClass;
  } else {
    rest = bought;
    title = "Position";
    dotClass = getThesisStatusDisplay("HOLDING").dotClass;
    gain = unrealized;
  }

  // The click opens the trade, except on a waiting proposal, where it expands the reason instead.
  const proposal = Boolean(pp && !pp.executing);
  const [expanded, setExpanded] = useState(false);
  return (
    <Card
      className={cn("group/banner relative bg-muted/40 p-3 gap-2", proposal && "cursor-pointer")}
      onClick={proposal ? () => setExpanded((v) => !v) : undefined}
    >
      {/* The whole card opens the trade: a stretched link under the content, never a link around the controls. */}
      {position.id && !proposal ? (
        <Link href={`/trades/${position.id}`} aria-label="Open the trade" className="absolute inset-0 rounded-xl" />
      ) : null}
      {/* The title row: the dot where the other headings keep their icon; Review (or Executing) at the right edge. */}
      <SectionLabel
        className="relative"
        action={reviewSlot ? <span className="flex items-center" onClick={(e) => e.stopPropagation()}>{reviewSlot}</span> : null}
      >
        <span className={cn("inline-flex items-center gap-1.5", proposal && "group-hover/banner:hidden")}>
          <span className={cn("size-2 rounded-full shrink-0", dotClass)} />
          {title}
        </span>
        {proposal ? (
          <span className="hidden items-center gap-1.5 group-hover/banner:inline-flex">
            <HugeiconsIcon icon={ExpandIcon} className="size-3.5" />
            {expanded ? "Hide reasoning" : "Read reasoning"}
          </span>
        ) : null}
      </SectionLabel>
      <div className="relative flex items-center justify-between gap-3 pointer-events-none text-sm">
        <span className="font-normal tabular-nums truncate">
          {lead ? <span className="font-medium">{lead}</span> : null}
          {rest}
        </span>
        {gain ? <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="sm" className="shrink-0" /> : null}
      </div>
      {pp && !pp.executing ? (
        <div className="relative">
          <ProposalNote orderId={pp.orderId} reason={pp.rationale} writing={pp.writing ?? false} expanded={expanded} />
        </div>
      ) : null}
    </Card>
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
