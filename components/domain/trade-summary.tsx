"use client";

/**
 * TradeSummary — the ONE trade section, in two looks.
 *
 * The thesis sheet and the trade page read the same position (the dossier's)
 * and the same live P&L (the quote's), so the numbers can't drift between
 * them. What differs is the look:
 *
 *   • "banner" — the block under the price: a proposal with its Review
 *     control and reason, a holding with its gain, or a closed trade with
 *     its result. The sheet shows it in every state; the page shows it only
 *     while a proposal waits (the card carries the held numbers there).
 *   • "card"   — the page's right-hand position card: status pill and days
 *     held, the gain in the header's PriceChange, then Bought / Sold / Now /
 *     Exit rows in the Trade Details style. Nothing while a buy is only
 *     proposed — no shares exist yet.
 *
 * The sentence is built by the SHARED buildTradeSentence and the row is the
 * SHARED <TradeStatement>; this file only picks per-state inputs.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PriceChange } from "@/components/ui/price-change";
import { ResearchBrief } from "@/components/domain/research-brief";
import { TradeStatement, type TradeStatementGain } from "@/components/ui/trade-statement";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildTradeSentence } from "@/lib/trade-statement";
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

// The proposal's own write-up. These run long — the agent explains the level,
// the risk math, the exposure after the buy — and at full length the block
// pushed the chart and the triggers off the screen. Clamped to four lines,
// the whole paragraph is the hit area, click toggles.
function TradeNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <p
      className={cn(
        "text-sm text-muted-foreground leading-relaxed cursor-pointer transition-colors hover:text-foreground",
        !open && "line-clamp-4",
      )}
      onClick={() => setOpen((v) => !v)}
      title={open ? "Collapse" : "Expand"}
    >
      {text}
    </p>
  );
}

export function TradeSummary(props: TradeSummaryProps) {
  return props.look === "card" ? <TradeCard {...props} /> : <TradeBanner {...props} />;
}

// ── The banner ──
// Every state — pending proposal, holding, closed — renders through the SAME
// container and the SAME slot layout (Review · statement · note · brief ·
// meta). Only the slot values differ per state. The headings follow one
// grammar:
//   • pending buy      → "Proposed: Buy N shares at $entry"
//   • holding          → "Bought N shares at $entry, now trading at $current"
//   • closed           → "Bought N shares at $entry, closed at $closePrice"
//   • held + pending   → "Proposed: Sell at $current, bought N shares at $entry"
function TradeBanner({ position, pnl, pendingProposal, direction }: TradeSummaryProps) {
  const pp = pendingProposal;
  const entry = position.avgCost;
  const current = pnl?.currentPrice ?? null;

  let sentence: string | null;
  let review: ReactNode = null;
  let gain: TradeStatementGain | null = null;
  let dotClass = "bg-muted-foreground/40";
  let note: string | null = null;
  let meta: string | null = null;

  // The slot above the statement. While the decision is yours it holds the
  // Review control; once you've approved, the order is at Alpaca and there is
  // nothing left to decide, so the same slot reads a shimmering "Executing"
  // until the fill lands (PRAX, 2026-08-31). An order already sent can't
  // lapse, so its "Expires" meta goes too.
  let reviewSlot: ReactNode = null;
  let proposalMeta: string | null = null;
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
    proposalMeta = pp.expiresAt ? `Expires ${fmtTradeDate(pp.expiresAt)}` : null;
  }

  if (pp && pp.intent === "OPEN") {
    sentence = buildTradeSentence({
      kind: "proposed-buy",
      qty: pp.quantity,
      entry,
      buyVerb: direction === "SHORT" ? "Short" : "Buy",
      executing: pp.executing,
    });
    review = reviewSlot;
    // Amber is "waiting on you"; once at Alpaca it takes the holding row's
    // live-and-open blue, from the shared status map.
    dotClass = getTradeStatusDisplay(pp.executing ? "OPEN" : "PENDING").dotClass;
    note = pp.rationale;
    meta = proposalMeta;
  } else if (pp) {
    sentence = buildTradeSentence({
      kind: "proposed-exit",
      qty: position.quantity,
      entry,
      current,
      exitVerb: pp.intent === "ADD" ? "add" : pp.intent === "CLOSE" ? "close" : "trim",
      proposalQty: pp.quantity,
      executing: pp.executing,
    });
    review = reviewSlot;
    dotClass = getTradeStatusDisplay(pp.executing ? "OPEN" : "PENDING").dotClass;
    if (pnl != null) gain = { dollar: pnl.unrealizedPnl, pct: pnl.unrealizedPnlPct };
    note = pp.rationale;
    meta = proposalMeta;
  } else if (position.closed) {
    sentence = buildTradeSentence({
      kind: "closed",
      qty: position.quantity,
      entry,
      closePrice: position.closePrice,
    });
    dotClass = "bg-muted-foreground/40";
    if (position.realizedPnl != null)
      gain = { dollar: position.realizedPnl, pct: position.realizedPnlPct ?? 0 };
    note = humanizeCloseReason(position.closeReason);
    meta = position.closedAt ? `Closed ${fmtTradeDate(position.closedAt)}` : null;
  } else {
    sentence = buildTradeSentence({
      kind: "holding",
      qty: position.quantity,
      entry,
      current,
    });
    dotClass = "bg-positive";
    if (pnl != null) gain = { dollar: pnl.unrealizedPnl, pct: pnl.unrealizedPnlPct };
    meta =
      `Opened ${fmtTradeDate(position.openedAt)}` +
      (position.daysHeld > 0 ? ` · ${position.daysHeld}d held` : "");
  }

  return (
    <div className="rounded-lg border px-4 py-3 space-y-1.5">
      {/* Review sits on its own row ABOVE the statement, left-aligned — the
          statement row is always the same shape (dot + sentence left, P&L
          right), never squeezed by an action control. */}
      {review ? <div className="flex justify-start">{review}</div> : null}
      <TradeStatement dotClass={dotClass} sentence={sentence} gain={gain} />
      {note ? <TradeNote text={note} /> : null}
      {pp && !pp.executing ? <ResearchBrief orderId={pp.orderId} initial={pp.brief ?? null} /> : null}
      {/* Meta line doubles as the path to the trade detail page. */}
      {meta || position.id ? (
        <p className="text-xs text-muted-foreground">
          {meta}
          {position.id ? (
            <>
              {meta ? " · " : null}
              <Link
                href={`/trades/${position.id}`}
                className="hover:text-foreground hover:underline underline-offset-2"
              >
                View trade →
              </Link>
            </>
          ) : null}
        </p>
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
