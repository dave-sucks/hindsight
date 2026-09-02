"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreVertical, Plus } from "lucide-react";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn, pnlColor } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  getTradeStatusDisplay,
  shortAlpacaId,
  EXECUTING_LABEL,
  EXECUTING_TOOLTIP,
} from "@/lib/trade-status";
import type { TradeStatus } from "@/lib/mock-data/trades";
import { useTickerQuote } from "@/hooks/useTickerQuote";
import { usePinned } from "@/hooks/usePinned";
import { toast } from "sonner";

// ── Row menu item ────────────────────────────────────────────────────────────
// Every trade-shaped row gets the same kebab menu on the right edge. Each
// variant feeds it a list of items — the shell renders the trigger.

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

// ── Shell ────────────────────────────────────────────────────────────────────
// One layout primitive for every trade-shaped row in the app — trade rows,
// watchlist rows, the "Add Stock" prompt. Keeping every variant on this shell
// is what guarantees they stay visually identical (regression-proof).

export interface TradeRowShellProps {
  /** Where the row links to. If omitted the row is a static <div>. */
  href?: string;
  /** Logo + (optional) dot region. */
  leading: React.ReactNode;
  /** Top-left content (ticker + dot/icons). */
  primary: React.ReactNode;
  /** Top-right content (price). */
  trailingTop?: React.ReactNode;
  /** Bottom-left content (cost basis / "Watching" / hint). */
  secondary?: React.ReactNode;
  /** Bottom-right content (P&L badge). */
  trailingBottom?: React.ReactNode;
  /** Kebab-menu actions, shown on hover at the right edge. */
  menuItems?: RowMenuItem[];
  flash?: "win" | "loss";
  className?: string;
  /** Click handler when href is omitted (e.g. opens combobox). */
  onClick?: () => void;
}

// Exported so other trade-shaped surfaces (e.g. the Coverage Table) compose
// the SAME shell with status-specific slots instead of inventing a new row.
// This is the standing "ONE trade-row design everywhere" rule made reusable.
export function TradeRowShell({
  href,
  leading,
  primary,
  trailingTop,
  secondary,
  trailingBottom,
  menuItems,
  flash,
  className,
  onClick,
}: TradeRowShellProps) {
  const rowClasses = cn(
    "relative flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 transition-colors border-b border-border/40 last:border-0 group",
    flash === "win" && "bg-positive/10",
    flash === "loss" && "bg-negative/10",
    className,
  );

  const content = (
    <>
      {leading}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">{primary}</div>
          {trailingTop}
        </div>
        {(secondary !== undefined || trailingBottom !== undefined) && (
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-xs text-muted-foreground tabular-nums truncate">
              {secondary}
            </span>
            {trailingBottom !== undefined && (
              <div className="flex items-center gap-1.5 shrink-0">{trailingBottom}</div>
            )}
          </div>
        )}
      </div>
      {menuItems && menuItems.length > 0 && <RowMenu items={menuItems} />}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={rowClasses}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(rowClasses, "w-full text-left")}>
      {content}
    </button>
  );
}

// ── Row menu — overlays the leading logo on hover ───────────────────────────
// Same size + shape as StockLogo size="md" (size-8 rounded-md) so the button
// drops cleanly on top of it.

function RowMenu({ items }: { items: RowMenuItem[] }) {
  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              /* secondary, not outline: the button sits ON TOP of the row's
                 logo, and outline's dark-mode fill is translucent
                 (dark:bg-input/30) so the logo showed straight through it and
                 the kebab was invisible. secondary is opaque. */
              variant="secondary"
              size="icon"
              className="rounded-md"
              aria-label="Row actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          }
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4}>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              variant={item.destructive ? "destructive" : undefined}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                item.onSelect();
              }}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ── Pin / Unpin ──────────────────────────────────────────────────────────────
// Every trade-shaped row carries this entry. The row is the one place a stock
// is always reachable in this app, so it's the one place the pin affordance
// has to live — no surface has to opt in, and none has to pass pin state down.

function usePinMenuItem(ticker: string): RowMenuItem {
  const { pinned, toggle } = usePinned(ticker);
  return {
    label: pinned ? "Unpin" : "Pin",
    onSelect: () => {
      void toggle().then((res) => {
        if (!res.ok) {
          toast.error(res.error ?? `Couldn't ${pinned ? "unpin" : "pin"} ${ticker}`);
        }
      });
    },
  };
}

// ── GainPair — the number every row ends with ────────────────────────────────
// Dollar amount + percent badge, same weights and colours whether it's a held
// position's lifetime P&L or a watched name's move today. ONE component so a
// trade row and a watchlist row can never drift into showing the gain
// differently — the whole point of "one row design everywhere".

function GainPair({ dollar, pct }: { dollar: number; pct: number }) {
  return (
    <>
      <span className={cn("text-sm tabular-nums", pnlColor(dollar))}>
        {dollar >= 0 ? "+" : ""}${Math.abs(dollar).toFixed(2)}
      </span>
      <PnlBadge value={pct} format="percent" className="text-xs" />
    </>
  );
}

// ── TradeRow (existing API, now built on shell) ──────────────────────────────

interface TradeRowProps {
  id: string;
  ticker: string;
  currentPrice: number;
  entryPrice?: number;
  shares?: number;
  pnl: number;
  pnlPct: number;
  status: string;
  openedAt?: Date | string;
  closedAt?: string;
  placedAt?: string;
  filledAt?: string;
  priceSource?: "alpaca" | "finnhub" | "missing";
  priceUpdatedAt?: string;
  alpacaOrderId?: string;
  flash?: "win" | "loss";
  className?: string;
  /** Optional close-trade handler. When provided, kebab menu shows "Close trade". */
  onClose?: () => void;
  /**
   * Trade-as-Proposal — when set, the row renders in the "Pending" state:
   * amber status dot + the verb ("Buy" / "Sell" / ...) leading the ticker.
   * The row deliberately carries NO inline approve/reject control: a row is
   * never enough context to decide on a trade, and every attempt to cram more
   * into it failed. Clicking the row opens the thesis sheet, which is where
   * the Review dropdown lives alongside the reasoning behind the proposal.
   * orderId is the AWAITING_APPROVAL Order's id. intent tells the row which
   * verb to surface. See docs/plans/TRADE_AS_PROPOSAL.md.
   */
  pendingProposal?: {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
    /** Shares this proposal moves — the Order's qty, not the position's. */
    quantity: number;
    /** ISO — when the proposal lapses; drives the Expired state on the Review control. */
    expiresAt?: string;
    /**
     * Approved, sent to Alpaca, not filled yet. The row stays exactly where it
     * was and reads a shimmering "Executing" in the verb's place, so approving
     * a trade doesn't look like the app lost it. Clears itself on the fill.
     */
    executing?: boolean;
  };
  /** When present, clicking the row opens ThesisSheet instead of navigating to /trades/:id. */
  thesisId?: string;
  /** Thesis direction — needed as the sheet's seed prop when thesisId is set. */
  direction?: "LONG" | "SHORT";
}

/** The verb the row leads with when a proposal is awaiting approval. */
const PROPOSAL_VERB: Record<"OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE", string> = {
  OPEN: "Buy",
  ADD: "Add",
  CLOSE: "Sell",
  PARTIAL_CLOSE: "Trim",
};

function fmtShort(d: Date | string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    d instanceof Date ? d : new Date(d),
  );
}

function fmtPriceSource(source: string | undefined, updatedAt: string | undefined): string {
  if (source === "alpaca")
    return `Live via Alpaca${updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}` : ""}`;
  if (source === "finnhub")
    return `Via Finnhub${updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}` : ""}`;
  if (source === "missing") return "No live price — showing entry";
  return "";
}

export function TradeRow({
  id,
  ticker,
  currentPrice,
  entryPrice,
  shares = 1,
  pnl,
  pnlPct,
  status,
  openedAt,
  closedAt,
  placedAt,
  filledAt,
  priceSource,
  priceUpdatedAt,
  alpacaOrderId,
  flash,
  className,
  onClose,
  pendingProposal,
  thesisId,
  direction,
}: TradeRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const pinMenuItem = usePinMenuItem(ticker);
  const dateStr = openedAt ? fmtShort(openedAt) : null;
  const isPending = status === "PENDING";
  const isAwaitingApproval = pendingProposal != null;
  const isExecuting = pendingProposal?.executing === true;

  // A proposal row describes the ORDER, not the holding. `shares` is the
  // position size (it drives P&L everywhere else), so a trim of 13 out of a
  // 52-share position was rendering as "52 shares / $15,992" next to an
  // Approve button that would only move 13. Show what's actually being
  // approved, and keep the holding size visible as "13 of 52".
  const displayShares = isAwaitingApproval ? pendingProposal.quantity : shares;
  const totalWorth = currentPrice * displayShares;
  const isPartial = isAwaitingApproval && pendingProposal.quantity < shares;
  const isOpen = status === "OPEN" || isPending || isAwaitingApproval;
  const isStalePrice = isOpen && priceSource === "missing";
  // A row with no holding behind it (a brand-new buy proposal, or a buy still
  // in flight) has no lifetime P&L to show — fill that slot with the day's
  // move instead of an em-dash, same source and same GainPair as WatchlistRow.
  // Only fetched for rows that need it.
  const dayQuote = useTickerQuote(isPending && !isStalePrice ? ticker : undefined);

  const cfg = getTradeStatusDisplay(status);
  const timeLabel = isExecuting
    ? EXECUTING_TOOLTIP
    : isAwaitingApproval
      ? `Pending your approval — agent proposed this ${pendingProposal.intent === "OPEN" || pendingProposal.intent === "ADD" ? "buy" : "exit"}`
      : cfg.timeLabel({ placedAt, filledAt, closedAt });
  const shortId = shortAlpacaId(alpacaOrderId);
  const priceSourceLabel = isOpen ? fmtPriceSource(priceSource, priceUpdatedAt) : null;

  // Pin/unpin is on EVERY trade-shaped row, app-wide — the row is the one
  // place a stock is always reachable, so it's the one place the affordance
  // has to live. State comes from the shared pin cache, not from props, so no
  // call site has to plumb it.
  const menuItems: RowMenuItem[] = [
    pinMenuItem,
    ...(onClose && isOpen && !isAwaitingApproval
      ? [{ label: "Close trade", onSelect: onClose, destructive: true }]
      : []),
  ];

  return (
    <>
    <TradeRowShell
      href={thesisId ? undefined : `/trades/${id}`}
      onClick={thesisId ? () => setSheetOpen(true) : undefined}
      flash={flash}
      className={className}
      menuItems={menuItems}
      leading={<StockLogo ticker={ticker} size="md" className="rounded-md" />}
      primary={
        <>
          {/* Reads as "Trim SNOW" / "Buy HPE". The dropdown offers Approve
              before you'd otherwise know what you're approving — the verb is
              the missing half of that decision. Lighter weight so the ticker
              still leads the row visually. */}
          {isAwaitingApproval && (
            <span
              className={cn(
                "text-sm font-light text-muted-foreground",
                // Approved and in flight — the same shimmer the agent's
                // in-progress rows use, in the verb's slot. It's the whole
                // signal that the trade is on its way rather than lost.
                isExecuting && "shimmer-text",
              )}
            >
              {isExecuting ? EXECUTING_LABEL : PROPOSAL_VERB[pendingProposal.intent]}
            </span>
          )}
          <span className="text-sm font-medium">{ticker}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0 cursor-default",
                    // Pending proposal — amber dot overrides whatever the
                    // underlying status would normally show.
                    isAwaitingApproval ? "bg-amber-500" : cfg.dotClass,
                  )}
                />
              }
            />
            <TooltipContent side="top">
              <div>
                <div>{timeLabel}</div>
                {shortId && (
                  <div className="opacity-60 font-mono text-[10px]">Alpaca {shortId}</div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </>
      }
      trailingTop={
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex items-center gap-1 text-sm tabular-nums font-light cursor-default">
                ${currentPrice.toFixed(2)}
              </span>
            }
          />
          <TooltipContent side="top">
            <div>
              {priceSourceLabel ? <div>{priceSourceLabel}</div> : <div>Closing price</div>}
              {isStalePrice && entryPrice != null && (
                <div className="opacity-60 text-[10px]">
                  Showing entry ${entryPrice.toFixed(2)}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      }
      secondary={
        <>
          {formatCurrency(totalWorth)} — {displayShares}
          {isPartial && <> of {shares}</>} share{displayShares !== 1 ? "s" : ""}
          {dateStr && <> · {dateStr}</>}
        </>
      }
      trailingBottom={
        isStalePrice ? (
          <span className="text-[10px] text-amber-500/80">no live price</span>
        ) : isPending ? (
          dayQuote ? (
            <GainPair dollar={dayQuote.change} pct={dayQuote.changePct} />
          ) : (
            <span className="text-[10px] text-muted-foreground/50">—</span>
          )
        ) : (
          <GainPair dollar={pnl} pct={pnlPct} />
        )
      }
    />
    {thesisId && (
      <ThesisSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        thesis_id={thesisId}
        ticker={ticker}
        direction={direction ?? null}
        confidence_score={0}
      />
    )}
    </>
  );
}

// ── WatchlistRow ─────────────────────────────────────────────────────────────
// Identical to TradeRow — same price, same GainPair, same everything. The ONLY
// difference is the subline: a watched name has no position, so there's no
// value + share count to put there.
//   null / 'PENDING' → "Awaiting review"  (unresearched seed — explicit)
//   anything else    → "Watching"
// The direction used to be tacked on ("Watching — long"). It was filler for an
// otherwise-empty slot and it's gone; direction still seeds the thesis sheet.
// P1-24 B4: the unresearched-seed sentinel is direction=null (legacy 'PENDING'
// kept for the dual-read window). Both render "Awaiting review".

interface WatchlistRowProps {
  ticker: string;
  /** Live or last close price. */
  currentPrice?: number;
  /**
   * Thesis direction for the underlying WATCHING thesis. Seeds the thesis
   * sheet; it is NOT printed on the row. An unresearched seed (explicit null,
   * or legacy 'PENDING') is the one case that changes the subline — it reads
   * "Awaiting review" instead of "Watching".
   */
  direction?: "LONG" | "SHORT" | "PENDING" | null;
  onRemove?: () => void;
  className?: string;
  /** When present, clicking the row opens ThesisSheet instead of navigating to /stocks/:ticker. */
  thesisId?: string;
}

export function WatchlistRow({
  ticker,
  currentPrice,
  direction,
  onRemove,
  className,
  thesisId,
}: WatchlistRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const pinMenuItem = usePinMenuItem(ticker);
  // The day's move in dollars AND percent — from the SAME shared quote source
  // every other price/day-change surface uses (ticker chips, thesis cards):
  // /api/quotes via the useTickerQuote cache. A watched name isn't held, so the
  // day's move fills the slot a trade row uses for its lifetime P&L, rendered
  // by the same GainPair so the two rows are visually identical.
  const quote = useTickerQuote(ticker);
  const menuItems: RowMenuItem[] = [
    pinMenuItem,
    ...(onRemove ? [{ label: "Remove", onSelect: onRemove, destructive: true }] : []),
  ];
  // P1-24 B4 dual-read: explicit null (new seed) or legacy 'PENDING' →
  // "Awaiting review". Everything else is just "Watching".
  const secondary =
    direction === null || direction === "PENDING" ? "Awaiting review" : "Watching";
  return (
    <>
    <TradeRowShell
      href={thesisId ? undefined : `/stocks/${ticker}`}
      onClick={thesisId ? () => setSheetOpen(true) : undefined}
      className={className}
      leading={<StockLogo ticker={ticker} size="md" className="rounded-md" />}
      primary={<span className="text-sm font-medium">{ticker}</span>}
      trailingTop={
        <span className="inline-flex items-center gap-1 text-sm tabular-nums font-light">
          {currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—"}
        </span>
      }
      secondary={secondary}
      trailingBottom={
        quote ? <GainPair dollar={quote.change} pct={quote.changePct} /> : undefined
      }
      menuItems={menuItems}
    />
    {thesisId && (
      <ThesisSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        thesis_id={thesisId}
        ticker={ticker}
        direction={direction === "LONG" || direction === "SHORT" ? direction : null}
        confidence_score={0}
      />
    )}
    </>
  );
}

// ── AddStockRow ──────────────────────────────────────────────────────────────
// Skeleton-styled prompt that looks like a row but invites the user to add.
// Click handler typically opens a stock combobox.

export function AddStockRow({
  label = "Add Stock to Watchlist",
  onClick,
  className,
}: {
  label?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <TradeRowShell
      onClick={onClick}
      className={className}
      leading={
        <div className="size-8 rounded-md bg-muted/60 flex items-center justify-center text-muted-foreground">
          <Plus className="h-4 w-4" />
        </div>
      }
      primary={<span className="text-sm font-medium text-muted-foreground">{label}</span>}
    />
  );
}
