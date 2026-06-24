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
import { getTradeStatusDisplay, shortAlpacaId } from "@/lib/trade-status";
import type { TradeStatus } from "@/lib/mock-data/trades";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import { useTickerQuote } from "@/hooks/useTickerQuote";

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
              variant="outline"
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
   * Trade-as-Proposal — when set, the row renders in "Pending review" state:
   * status dot turns amber, the P&L slot is replaced with inline
   * [Approve][Reject] buttons calling the existing /api/proposals routes.
   * orderId is the AWAITING_APPROVAL Order's id. intent tells the row which
   * verb to surface ("Buy" / "Close" / etc.). See docs/plans/TRADE_AS_PROPOSAL.md.
   */
  pendingProposal?: {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
  };
  /** When present, clicking the row opens ThesisSheet instead of navigating to /trades/:id. */
  thesisId?: string;
  /** Thesis direction — needed as the sheet's seed prop when thesisId is set. */
  direction?: "LONG" | "SHORT";
}

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
  const totalWorth = currentPrice * shares;
  const dateStr = openedAt ? fmtShort(openedAt) : null;
  const isPending = status === "PENDING";
  const isAwaitingApproval = pendingProposal != null;
  const isOpen = status === "OPEN" || isPending || isAwaitingApproval;
  const isStalePrice = isOpen && priceSource === "missing" && !isAwaitingApproval;

  const cfg = getTradeStatusDisplay(status);
  const timeLabel = isAwaitingApproval
    ? `Pending your approval — agent proposed this ${pendingProposal.intent === "OPEN" || pendingProposal.intent === "ADD" ? "buy" : "exit"}`
    : cfg.timeLabel({ placedAt, filledAt, closedAt });
  const shortId = shortAlpacaId(alpacaOrderId);
  const priceSourceLabel = isOpen ? fmtPriceSource(priceSource, priceUpdatedAt) : null;

  const menuItems: RowMenuItem[] | undefined =
    onClose && isOpen && !isAwaitingApproval
      ? [{ label: "Close trade", onSelect: onClose, destructive: true }]
      : undefined;

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
          {formatCurrency(totalWorth)} — {shares} share{shares !== 1 ? "s" : ""}
          {dateStr && <> · {dateStr}</>}
        </>
      }
      trailingBottom={
        isAwaitingApproval ? (
          <ProposalActions orderId={pendingProposal.orderId} />
        ) : isStalePrice ? (
          <span className="text-[10px] text-amber-500/80">no live price</span>
        ) : isPending ? (
          <span className="text-[10px] text-muted-foreground/50">—</span>
        ) : (
          <>
            <span className={cn("text-sm tabular-nums", pnlColor(pnl))}>
              {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
            </span>
            <PnlBadge value={pnlPct} format="percent" className="text-xs" />
          </>
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
// Identical to TradeRow visually. The only difference: no shares means no
// cost basis and no P&L. Subline reflects the underlying thesis state:
//   null / 'PENDING' → "Awaiting review"  (unresearched seed — explicit)
//   LONG / SHORT     → "Watching — long" / "Watching — short"
//   undefined        → "Watching"         (no thesis context, e.g. config form)
// P1-24 B4: the unresearched-seed sentinel is now direction=null (legacy
// 'PENDING' kept for the dual-read window). Both render "Awaiting review".
// `undefined` is distinct from `null`: it means the caller has no thesis
// direction to report at all (the config-form watchlist), not a researched-
// not-yet seed — so it keeps the generic "Watching".
// Price renders the same way as on a trade row.

interface WatchlistRowProps {
  ticker: string;
  /** Live or last close price. */
  currentPrice?: number;
  /**
   * Thesis direction for the underlying WATCHING thesis. LONG/SHORT surface
   * their direction; an unresearched seed (explicit null, or legacy
   * 'PENDING') surfaces as "Awaiting review"; undefined (no thesis context)
   * falls back to generic "Watching".
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
  // The day's % change — from the SAME shared quote source every other
  // price/day-change surface uses (ticker chips, thesis cards): /api/quotes via
  // the useTickerQuote cache. A watched name isn't held, so the row shows the
  // day's move in the slot a trade row uses for its lifetime P&L.
  const dayChangePct = useTickerQuote(ticker)?.changePct;
  // P1-24 B4 dual-read: explicit null (new seed) or legacy 'PENDING' →
  // "Awaiting review". LONG/SHORT surface their lean. undefined (no thesis
  // context) keeps the generic "Watching".
  const secondary =
    direction === "LONG"
      ? "Watching — long"
      : direction === "SHORT"
        ? "Watching — short"
        : direction === undefined
          ? "Watching"
          : "Awaiting review";
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
        dayChangePct != null ? (
          <PnlBadge value={dayChangePct} format="percent" className="text-xs" />
        ) : undefined
      }
      menuItems={
        onRemove
          ? [{ label: "Remove", onSelect: onRemove, destructive: true }]
          : undefined
      }
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
