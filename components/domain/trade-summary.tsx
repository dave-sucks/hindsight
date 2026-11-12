"use client";

/**
 * TradeSummary — the ONE position element, in two looks (the owner's design,
 * 2026-11-05): the active position is the Position row, a rollup of every
 * fill into what is held now (its average cost after every add, its result
 * once sold), and it reads one way on the sheet and one way on a page, in
 * every state — proposal waiting, holding, closed.
 *
 *   • "banner" — the sheet's: a plain muted card under the price, a step
 *     less rounded, a link to the stock's page; the title row (the answer
 *     buttons at its right while a proposal waits), then the sentence with
 *     the gain, a hair below; a waiting proposal's reason under them on a
 *     click, in which case the card is not a link.
 *   • "card"   — a page's sidebar card (the owner's order, 2026-11-05, redone
 *     the same night): the same title row, nothing at its right; the gain
 *     large; the sentence large and light ("Bought 27 shares at $369.25");
 *     a footnote with the value, the days held and the thesis's past trades;
 *     a rule; then the words (a proposal's reason, or the newest analyst
 *     note on the stock, five lines and a click for the rest), then the
 *     buttons at the foot's right: Reject / Accept (Accept primary) while a
 *     proposal waits, else Buy and, while the position is open, Sell, both
 *     outline. No Bought @ / Now @ rows: the entry is in the sentence, the
 *     live price in the header above the card.
 *   The title row is the same element on both, to the pixel (the owner,
 *   2026-11-06): one size up from a section label, regular, its dot and its
 *   shimmer from the same description.
 *
 * A waiting proposal is the agent asking (the owner, 2026-11-05): the same
 * layout and the same card surface, only two things move — a white dot that
 * breathes fast and the word "Proposal" shimmering. No amber, no gradient
 * (one was tried 11-05 and could not be seen).
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
import { Separator } from "@/components/ui/separator";
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
  /** Given (a page), the card's click opens the Transactions tab. The sheet's banner is a link to the stock's page instead. */
  onOpen?: () => void;
  /** The thesis's trades all in; the page card's footnote counts the past ones. */
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
// never disagree about the same trade (the owner's words, 2026-11-05): the
// title names the state and, on a proposal, the action and its size; the
// line under it is ONE shape in every state (the owner's final, 2026-11-08):
//   verb + shares, the dollars (the avg cost in parentheses), no date (the
//   date is the footnote's "held").
//   • holding          → the foreground dot, breathing · "Position"
//                        "Holding 11 shares, $7,590.00 value (avg cost $911.42)"
//   • closed           → green or red dot by the result · "Closed position"
//                        "Sold 20 shares, $8,078.78 value (avg cost $355.28)"
//   • proposed buy     → white breathing dot · "Proposal · Buy"
//                        "Buy 14 shares, $749.70 cost"  (no avg cost: the price is the stock's price now)
//   • proposed sell / trim / add → "Proposal · Sell 11 shares" / "Proposal · Trim 4 shares" / "Proposal · Add 4 shares"
//                        and the holding's own line under it — the title already says the action.
// The card's line is the same without the parentheses: its avg cost sits in
// the footnote beside the days held.
function describeTrade({ position, pnl, pendingProposal, direction, look }: TradeSummaryProps) {
  const pp = pendingProposal;
  const usd = (n: number) => formatCurrency(n);
  const shares = (n: number) => `${fmtQty(n)} ${n === 1 ? "share" : "shares"}`;
  const unrealized: TradeStatementGain | null = pnl ? { dollar: pnl.unrealizedPnl, pct: pnl.unrealizedPnlPct } : null;
  // The dollars: what the shares are worth now, what the sale brought once closed, what a proposed buy would cost.
  const value = pnl?.marketValue ?? (position.closed && position.closePrice != null ? position.closePrice * position.quantity : position.avgCost * position.quantity);
  const banner = look === "banner";
  /** "Holding 11 shares, $7,590.00 value (avg cost $911.42)"; the card leaves the parentheses to its footnote. */
  const line = (verb: string, qty: number, dollars: string, cost: string | null) =>
    `${verb} ${shares(qty)}, ${dollars}` + (banner && cost ? ` (${cost})` : "");
  const avgCost = `avg cost ${usd(position.avgCost)}`;

  let sentence: string;
  let gain: TradeStatementGain | null = null;
  let title: string;
  /** The title's second half on a proposal: "Sell 11 shares", "Buy". */
  let action: string | null = null;
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
    reviewSlot = <ProposalActions orderId={pp.orderId} expiresAt={pp.expiresAt} align={banner ? "start" : "end"} />;
  }

  if (pp && pp.intent === "OPEN") {
    // Nothing is held yet: the line is the buy itself, and its price is the stock's price now, so no avg cost.
    const verb = direction === "SHORT" ? "Short" : "Buy";
    sentence = line(verb, pp.quantity, `${usd(value)} cost`, null);
    title = "Proposal";
    action = verb;
    dotClass = pp.executing ? getTradeStatusDisplay("OPEN").dotClass : PROPOSAL_DOT;
  } else if (pp) {
    // The title names the action and its size; the line stays the holding's own.
    const verb = pp.intent === "ADD" ? "Add" : pp.intent === "CLOSE" ? "Sell" : "Trim";
    sentence = line("Holding", position.quantity, `${usd(value)} value`, avgCost);
    title = "Proposal";
    action = `${verb} ${shares(pp.quantity)}`;
    dotClass = pp.executing ? getTradeStatusDisplay("OPEN").dotClass : PROPOSAL_DOT;
    gain = unrealized;
  } else if (position.closed) {
    sentence = line("Sold", position.quantity, `${usd(value)} value`, avgCost);
    if (position.realizedPnl != null) gain = { dollar: position.realizedPnl, pct: position.realizedPnlPct ?? 0 };
    title = "Closed position";
    dotClass = getTradeStatusDisplay((position.realizedPnl ?? 0) >= 0 ? "CLOSED_WIN" : "CLOSED_LOSS").dotClass;
  } else {
    sentence = line("Holding", position.quantity, `${usd(value)} value`, avgCost);
    title = "Position";
    dotClass = getThesisStatusDisplay("HOLDING").dotClass;
    gain = unrealized;
  }

  return { pp, sentence, gain, title, action, value, avgCost, dotClass, reviewSlot, proposal: Boolean(pp && !pp.executing) };
}

/** The waiting proposal's dot: white, breathing fast (`proposal-dot`, globals.css). */
const PROPOSAL_DOT = "bg-foreground proposal-dot";
/** The title row the two looks share, the same on both (the owner, 2026-11-06): one size up from a section label and regular, the dot (the accordion's chevron over it on hover, where the card is one), the word (shimmering on a proposal), the buttons at the right. */
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
    <SectionLabel className="relative" action={action} size="sm">
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

/** The newest analyst note at the foot of the page card: five lines, a click for the rest. */
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
      {open ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className="line-clamp-5">{paragraphs.join(" ")}</p>}
    </div>
  );
}

// ── The banner (the sheet) ──
// A plain card, a link to the stock's page (the owner, 2026-11-06: no
// overlaid link, no click handler; the trade's own page opens only from the
// sheet's expand). Two rows a hair apart: the title row, then the sentence
// with the gain at its right, the row setting the size once and the gain
// inheriting it. While a proposal waits the card is not a link: its answer
// buttons are a row of their own at the foot, the reason's first two lines sit
// above them, and a click anywhere else opens or closes the rest of it.
function TradeBanner(props: TradeSummaryProps) {
  const { ticker } = props;
  const { pp, sentence, gain, title, action, dotClass, reviewSlot, proposal } = describeTrade(props);
  const [expanded, setExpanded] = useState(false);
  const body = (
    <>
      {/* The title row: the state at the left, the gain at the right at the title's own size (the owner, 2026-11-08). */}
      <TradeTitle
        title={action ? `${title} · ${action}` : title}
        dotClass={dotClass}
        proposal={proposal}
        accordion={proposal}
        expanded={expanded}
        action={gain ? <span className="text-sm tabular-nums"><PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="inherit" /></span> : null}
      />
      <p className="truncate text-base tabular-nums">{sentence}</p>
      {/* The reason, muted: two lines until the card is clicked, then all of it (or the "Writing" line while the note is on its way). */}
      {pp && !pp.executing && (pp.rationale?.trim() || pp.writing) ? (
        <div className="pt-2">
          <ProposalNote orderId={pp.orderId} reason={pp.rationale} writing={pp.writing ?? false} expanded={expanded} muted />
        </div>
      ) : null}
      {/* A proposal's answer, or "Executing" once answered, as a third row at the left. */}
      {reviewSlot ? (
        <div className="flex pt-2" onClick={(e) => e.stopPropagation()}>
          {reviewSlot}
        </div>
      ) : null}
    </>
  );
  const card = "group/banner rounded-lg bg-muted/40 p-3 gap-0.5";
  if (proposal) {
    return (
      <Card className={cn(card, "cursor-pointer")} onClick={() => setExpanded((v) => !v)}>
        {body}
      </Card>
    );
  }
  if (!ticker) return <Card className={card}>{body}</Card>;
  return (
    <Link href={`/stocks/${ticker}`} className="block">
      <Card className={cn(card, "transition-colors hover:bg-muted/60")}>{body}</Card>
    </Link>
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
// The same position in the sidebar's shape, in every state (the owner's
// order, 2026-11-05): the title row, the state and on a proposal its action
// ("Position", "Proposal · Sell", "Proposal · Add 4 shares"), nothing at its
// right; the gain large; the sentence large ("Bought 27 shares at $369.25",
// "Buy 14 shares at $53.55") in the gain's own color at a light weight, so
// the whole block reads green or red with the gain the heavier of the two
// (the owner, 2026-11-06); a muted footnote with the value and the days
// held, a little apart; a rule the card's full width; then the words — a
// proposal's reason, else the newest analyst note — five lines, a click on
// them for the rest; then the buttons at the foot's right. The click
// elsewhere opens the Transactions tab.
function TradeCard(props: TradeSummaryProps) {
  const { position, onOpen, trades, note, ticker, analystId } = props;
  const { pp, sentence, gain, title, action, avgCost, dotClass, reviewSlot, proposal } = describeTrade(props);
  const click = onOpen;
  const closed = position.closed === true;
  const proposedBuy = pp?.intent === "OPEN";
  const pastTrades = trades ? Math.max(0, trades.count - 1) : 0;
  const footnote = [
    ...(!proposedBuy ? [avgCost, `Held ${position.daysHeld} day${position.daysHeld === 1 ? "" : "s"}`] : []),
    ...(pastTrades > 0 ? [`${pastTrades} past trade${pastTrades === 1 ? "" : "s"}`] : []),
  ].join(" · ");
  return (
    <Card className={cn("group/banner relative bg-muted/40 p-3 gap-3", click && "cursor-pointer")} onClick={click}>
      <TradeTitle title={action ? `${title} · ${action}` : title} dotClass={dotClass} proposal={proposal} accordion={false} expanded={false} action={null} />
      <div className="pointer-events-none">
        {gain ? <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="xl" /> : null}
        <p className={cn("text-xl font-light tabular-nums", gain ? (gain.dollar >= 0 ? "text-positive" : "text-negative") : "text-foreground")}>{sentence}</p>
        {/* The footnote: what the shares cost us, how long we have held them, and how many trades the thesis had before this one. */}
        {footnote ? <p className="mt-2 text-xs text-muted-foreground tabular-nums">{footnote}</p> : null}
      </div>
      {/* A rule the card's full width, splitting the numbers from the words. */}
      <div className="-mx-3">
        <Separator />
      </div>
      {pp && !pp.executing ? (
        <ProposalNote orderId={pp.orderId} reason={pp.rationale} writing={pp.writing ?? false} clamp={5} />
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
