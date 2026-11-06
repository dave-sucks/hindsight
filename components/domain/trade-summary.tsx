"use client";

/**
 * TradeSummary — the ONE position element, in two looks (the owner's design,
 * 2026-11-05): the active position is the Position row, a rollup of every
 * fill into what is held now (its average cost after every add, its result
 * once sold), and it reads one way on the sheet and one way on a page, in
 * every state — proposal waiting, holding, closed.
 *
 *   • "banner" — the sheet's: the muted card under the price, a title row with
 *     a coloured dot (Proposal / Position / Closed position, the answer
 *     buttons at its right while a proposal waits), the sentence with the
 *     date and the gain, a waiting proposal's reason under it.
 *   • "card"   — a page's sidebar card (the owner's order, 2026-11-05): the
 *     title row with nothing at its right, the share count, the gain large,
 *     a proposal's sentence, then Bought @ / Now @ (or Sold @) rows, then
 *     the words (a proposal's reason, or the newest analyst note on the
 *     stock, four lines and a click for the rest), then the buttons at the
 *     foot's right: Reject / Accept (Accept primary) while a proposal waits,
 *     else Buy and, while the position is open, Sell, both outline.
 *
 * A waiting proposal is the agent asking (the owner, 2026-11-05): the same
 * layout, only its colors change — a white dot that breathes fast, the word
 * "Proposal" shimmering, and a faint gradient over the card. No amber.
 *
 * The individual fills are the Transactions tab. Every surface reads the
 * same position (the dossier's) and the same live P&L (the quote's), so the
 * numbers can't drift. (The old Trade Details card is gone; its facts open
 * from a Transactions row.)
 */

import { getThesisStatusDisplay } from "@/lib/thesis-status";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PriceChange } from "@/components/ui/price-change";
import { ProposalNote } from "@/components/domain/proposal-note";
import { SectionLabel } from "@/components/domain/section-label";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TradeStatementGain } from "@/components/ui/trade-statement";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import { Button } from "@/components/ui/button";
import { TradeButton } from "@/components/trade/TradeButton";
import { CloseTradeDialog } from "@/components/trades/TradeActions";
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
  /** Given (a page), the card's click opens the Transactions tab; absent (the sheet), it links to the trade's page. */
  onOpen?: () => void;
  /** The thesis's trades all in; a line on the card once there is more than this one. */
  trades?: { count: number; realized: number } | null;
  /** The newest analyst note on the stock, for the page card's foot when no proposal waits. */
  note?: string | null;
  /** The stock, for the page card's Buy and Sell. */
  ticker?: string;
  /** The analyst the Buy starts on the side of. */
  analystId?: string | null;
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

// ── What the position says, in every state ──
// One description shared by the two looks, so the sheet and the page can
// never disagree about the same trade:
//   • proposal waiting → white breathing dot · "Proposal" (shimmering) · the answer buttons at the right
//                        "Add 4 shares: Bought N shares at $entry on Oct 5" / "Buy N shares at $entry on Nov 19"
//   • holding          → blue dot · "Position" · "Bought N shares at $entry on Oct 5"
//   • closed           → green or red dot by the result · "Closed position" · "Sold N shares at $close on Nov 19"
function describeTrade({ position, pnl, pendingProposal, direction }: TradeSummaryProps) {
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

  // The answer buttons while the decision is yours; "Executing" once the order is at Alpaca.
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
    dotClass = pp.executing ? getTradeStatusDisplay("OPEN").dotClass : PROPOSAL_DOT;
  } else if (pp) {
    // The verb carries the proposal's own size: "Add 4 shares:" before the position it adds to.
    lead = `${pp.intent === "ADD" ? "Add" : pp.intent === "CLOSE" ? "Sell" : "Trim"} ${shares(pp.quantity)}:`;
    rest = ` ${bought}`;
    title = "Proposal";
    dotClass = pp.executing ? getTradeStatusDisplay("OPEN").dotClass : PROPOSAL_DOT;
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

  return { pp, lead, rest, gain, title, dotClass, reviewSlot, proposal: Boolean(pp && !pp.executing) };
}

/** The waiting proposal's dot: white, breathing fast (`proposal-dot`, globals.css). */
const PROPOSAL_DOT = "bg-foreground proposal-dot";
/** The waiting proposal's card: a faint gradient over the stock cards' surface, nothing else moved. */
const PROPOSAL_CARD = "border-foreground/15 bg-gradient-to-br from-foreground/10 to-muted/40";

/** The title row the two looks share: the dot (the accordion's chevron over it on hover, where the card is one), the word (shimmering on a proposal), the buttons at the right. */
function TradeTitle({
  title,
  dotClass,
  proposal,
  accordion,
  expanded,
  action,
}: {
  title: string;
  dotClass: string;
  proposal: boolean;
  /** The card opens its note on click: the chevron over the dot on hover. */
  accordion: boolean;
  expanded: boolean;
  action: ReactNode;
}) {
  return (
    <SectionLabel className="relative" action={action}>
      {/* gap-2, not the headings' 1.5: the hover circle overhangs the dot by 6px and must not touch the word. */}
      <span className="inline-flex items-center gap-2">
        <span className="relative inline-flex size-2 shrink-0">
          <span className={cn("size-2 rounded-full", dotClass)} />
          {accordion ? (
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 hidden size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-secondary-foreground group-hover/banner:inline-flex"
            >
              {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </span>
          ) : null}
        </span>
        <span className={proposal ? "shimmer-text" : "text-foreground"}>{title}</span>
      </span>
    </SectionLabel>
  );
}

/** The newest analyst note at the foot of the page card: four lines, a click for the rest. */
function NoteClamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div
      className="space-y-2 text-sm font-light text-foreground leading-relaxed cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      title={open ? "Collapse" : "Expand"}
    >
      {open ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className="line-clamp-4">{paragraphs.join(" ")}</p>}
    </div>
  );
}

/** The thesis's other trades, when it has had more than this one: how many, and what the closed ones made. */
function TradesLine({ trades }: { trades: TradeSummaryProps["trades"] }) {
  if (!trades || trades.count <= 1) return null;
  return (
    <p className="relative flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums pointer-events-none">
      {trades.count} trades on this thesis · the closed ones made
      <PriceChange dollarChange={trades.realized} size="sm" />
    </p>
  );
}

// ── The banner (the sheet) ──
// The stock cards' surface, a title row, then the sentence with the gain on
// its right. A waiting proposal's reason is hidden until asked for, an
// accordion: a click anywhere on the card opens or closes it. Otherwise the
// click opens the trade's page.
function TradeBanner(props: TradeSummaryProps) {
  const { position, onOpen, trades } = props;
  const { pp, lead, rest, gain, title, dotClass, reviewSlot, proposal } = describeTrade(props);
  const [expanded, setExpanded] = useState(false);
  const click = proposal ? () => setExpanded((v) => !v) : onOpen;
  return (
    <Card className={cn("group/banner relative bg-muted/40 p-3 gap-2", proposal && PROPOSAL_CARD, click && "cursor-pointer")} onClick={click}>
      {/* On the sheet the whole card opens the trade: a stretched link under the content, never a link around the controls. */}
      {position.id && !proposal && !onOpen ? (
        <Link href={`/trades/${position.id}`} aria-label="Open the trade" className="absolute inset-0 rounded-xl" />
      ) : null}
      <TradeTitle
        title={title}
        dotClass={dotClass}
        proposal={proposal}
        accordion={proposal}
        expanded={expanded}
        action={reviewSlot ? <span className="flex items-center" onClick={(e) => e.stopPropagation()}>{reviewSlot}</span> : null}
      />
      <div className="relative flex items-center justify-between gap-3 pointer-events-none text-sm">
        <span className="font-normal tabular-nums truncate">
          {lead ? <span className="font-medium">{lead}</span> : null}
          {rest}
        </span>
        {gain ? <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="sm" className="shrink-0" /> : null}
      </div>
      <TradesLine trades={trades} />
      {/* No wrapper: closed, the note renders nothing, so the card's gap has nothing to count. */}
      {pp && !pp.executing ? <ProposalNote orderId={pp.orderId} reason={pp.rationale} writing={pp.writing ?? false} expanded={expanded} /> : null}
    </Card>
  );
}

/** The page card's foot: Buy, and Sell while the position is open; two small outline buttons that open the trade dialogs. */
function BuySell({ ticker, analystId, tradeId, canSell }: { ticker: string; analystId: string | null; tradeId: string | null; canSell: boolean }) {
  const [buySignal, setBuySignal] = useState(0);
  const [selling, setSelling] = useState(false);
  return (
    <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Button variant="outline" size="xs" onClick={() => setBuySignal((n) => n + 1)}>
        Buy
      </Button>
      {canSell && tradeId ? (
        <Button variant="outline" size="xs" onClick={() => setSelling(true)}>
          Sell
        </Button>
      ) : null}
      <TradeButton ticker={ticker} analystId={analystId} openSignal={buySignal} hideTrigger />
      {canSell && tradeId ? <CloseTradeDialog tradeId={tradeId} ticker={ticker} open={selling} onOpenChange={setSelling} /> : null}
    </span>
  );
}

// ── The card (a page's sidebar) ──
// The same position in the sidebar's shape, in every state: the title row
// (nothing at its right), the share count, the gain large, a proposal's
// sentence, then Bought @ / Now @ (or Sold @) rows with the dollars, then
// the words — a proposal's reason, else the newest analyst note — four
// lines, a click on them for the rest, then the buttons at the foot's right.
// The click elsewhere opens the Transactions tab.
function TradeCard(props: TradeSummaryProps) {
  const { position, pnl, onOpen, trades, note, ticker, analystId } = props;
  const { pp, lead, rest, gain, title, dotClass, reviewSlot, proposal } = describeTrade(props);
  const click = onOpen;
  const proposedBuy = pp?.intent === "OPEN";
  const cost = position.avgCost * position.quantity;
  const closed = position.closed === true;
  const rows: Array<{ label: string; value: string }> = proposedBuy
    ? [{ label: `Buy @ ${formatCurrency(position.avgCost)}`, value: formatCurrency(cost) }]
    : [
        { label: `Bought @ ${formatCurrency(position.avgCost)}`, value: formatCurrency(cost) },
        ...(closed && position.closePrice != null
          ? [{ label: `Sold @ ${formatCurrency(position.closePrice)}`, value: formatCurrency(position.closePrice * position.quantity) }]
          : !closed && pnl
            ? [{ label: `Now @ ${formatCurrency(pnl.currentPrice)}`, value: formatCurrency(pnl.marketValue) }]
            : []),
        ...(closed && humanizeCloseReason(position.closeReason) ? [{ label: "Exit", value: humanizeCloseReason(position.closeReason)! }] : []),
      ];
  return (
    <Card className={cn("group/banner relative bg-muted/40 p-3 gap-3", proposal && PROPOSAL_CARD, click && "cursor-pointer")} onClick={click}>
      <TradeTitle title={title} dotClass={dotClass} proposal={proposal} accordion={false} expanded={false} action={null} />
      <div>
        {/* The share count at the gain's size, in the foreground, over the gain. */}
        <p className="text-xl font-semibold tabular-nums">{fmtQty(position.quantity)} shares</p>
        {gain ? <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="xl" /> : null}
      </div>
      {lead ? (
        <p className="text-sm tabular-nums pointer-events-none">
          <span className="font-medium">{lead}</span>
          {rest}
        </p>
      ) : null}
      <div className="pointer-events-none">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between border-b border-border py-1 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </div>
      <TradesLine trades={trades} />
      {pp && !pp.executing ? (
        <ProposalNote orderId={pp.orderId} reason={pp.rationale} writing={pp.writing ?? false} clamp={4} />
      ) : note ? (
        <NoteClamp text={note} />
      ) : null}
      {/* The foot: the proposal's answer (Accept primary) while one waits, "Executing" once answered, else Buy and Sell. */}
      <div className="flex justify-end">
        {pp && !pp.executing ? (
          <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
            <ProposalActions orderId={pp.orderId} expiresAt={pp.expiresAt} align="end" accent />
          </span>
        ) : pp?.executing ? (
          <span className="flex items-center" onClick={(e) => e.stopPropagation()}>{reviewSlot}</span>
        ) : ticker ? (
          <BuySell ticker={ticker} analystId={analystId ?? null} tradeId={position.id ?? null} canSell={!closed} />
        ) : null}
      </div>
    </Card>
  );
}
