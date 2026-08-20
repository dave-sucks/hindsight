'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { StockLogo } from '@/components/StockLogo';
import { PriceChange } from '@/components/ui/price-change';
import { PriceGauge } from '@/components/ui/gauge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getTradeStatusDisplay, shortAlpacaId } from '@/lib/trade-status';
import { closeTrade, cancelTrade } from '@/lib/actions/closeTrade.actions';
import {
  mockOpenTrades,
  mockClosedTrades,
  type MockTrade,
} from '@/lib/mock-data/trades';
import { Loader2, MoreHorizontal, ExternalLink } from 'lucide-react';
import { ProposalActions } from '@/components/proposals/ProposalActions';
import { ConceptTooltip } from '@/components/domain/education-card';
import { EmptyStateBg } from '@/components/domain/empty-state-bg';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TradesPageProps {
  initialOpenTrades?: MockTrade[];
  initialClosedTrades?: MockTrade[];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'ALL' | 'OPEN' | 'CLOSED' | 'WON' | 'LOST';

// ─── Status helpers ──────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatExactTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
        <p className="text-sm">No trades match your filters</p>
      </div>
    );
  }
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl py-20 px-4">
      <div
        className="absolute inset-0"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 15%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
          maskComposite: "intersect",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 15%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
          WebkitMaskComposite: "source-in",
        }}
      >
        <EmptyStateBg />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-3">
        <p className="text-base font-medium">No paper trades yet</p>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          Trades are placed automatically when an analyst has high confidence in a thesis during a research session.
        </p>
        <Link
          href="/analysts"
          className="inline-flex items-center justify-center h-8 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-muted"
        >
          Create an Analyst
        </Link>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TradesPage({
  initialOpenTrades,
  initialClosedTrades,
}: TradesPageProps) {
  const router = useRouter();
  const openTrades = initialOpenTrades ?? mockOpenTrades;
  const closedTrades = initialClosedTrades ?? mockClosedTrades;
  const allTrades = useMemo(() => [...openTrades, ...closedTrades], [openTrades, closedTrades]);

  const [tab, setTab] = useState<FilterTab>('ALL');
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const closeTargetTrade = allTrades.find((t) => t.id === closeTarget);
  const cancelTargetTrade = allTrades.find((t) => t.id === cancelTarget);

  async function handleCloseTrade() {
    if (!closeTarget) return;
    setCloseLoading(true);
    try {
      await closeTrade(closeTarget, 'MANUAL');
      toast.success('Trade closed successfully');
      setCloseTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close trade');
    } finally {
      setCloseLoading(false);
    }
  }

  async function handleCancelTrade() {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      await cancelTrade(cancelTarget);
      toast.success('Trade cancelled');
      setCancelTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel trade');
    } finally {
      setCancelLoading(false);
    }
  }

  const filtered = useMemo(() => {
    switch (tab) {
      // PENDING (an unapproved buy proposal) is NOT closed — "not OPEN" is
      // the wrong test. Filter on the terminal states explicitly, and keep
      // pending alongside open so it stays reachable from a tab.
      case 'OPEN':
        return allTrades.filter((t) => t.status === 'OPEN' || t.status === 'PENDING');
      case 'CLOSED':
        return allTrades.filter(
          (t) =>
            t.status === 'CLOSED_WIN' ||
            t.status === 'CLOSED_LOSS' ||
            t.status === 'CLOSED_EXPIRED' ||
            t.status === 'CANCELLED' ||
            t.status === 'REJECTED',
        );
      case 'WON':
        return allTrades.filter((t) => t.status === 'CLOSED_WIN');
      case 'LOST':
        return allTrades.filter((t) => t.status === 'CLOSED_LOSS' || t.status === 'CLOSED_EXPIRED');
      default:
        return allTrades;
    }
  }, [allTrades, tab]);

  const isFiltered = tab !== 'ALL';

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'OPEN', label: 'Open' },
    { key: 'CLOSED', label: 'Closed' },
    { key: 'WON', label: 'Won' },
    { key: 'LOST', label: 'Lost' },
  ];

  return (
    <div className="h-[calc(100dvh-3rem)] flex flex-col">
      {/* Header + filter tabs — fixed at the top of the page; doesn't scroll */}
      <div className="px-4 sm:px-6 pt-6 pb-4 flex items-center justify-between gap-4 shrink-0">
        <h1 className="text-2xl font-semibold">Trades</h1>
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-md border px-1 py-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-colors',
                tab === t.key
                  ? 'bg-background text-foreground font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table container — takes remaining vertical space, scrolls both axes.
          Vertical scroll so long trade histories don't spill into page scroll;
          horizontal scroll handled by <Table>'s own overflow-x-auto wrapper. */}
      {filtered.length === 0 ? (
        <EmptyState filtered={isFiltered} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* border-separate + border-spacing-0 is REQUIRED for
              `position: sticky` on <th>/<td> to work — collapsed borders
              break sticky positioning across browsers. The TableHeader
              still gets its border-b via the [&_tr]:border-b selector
              from shadcn so visual rendering is unchanged. */}
          <Table className="border-separate border-spacing-0">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Name</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Current Price</TableHead>
              <TableHead className="text-right">P&amp;L</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Total Value</TableHead>
              <TableHead className="w-28">Target</TableHead>
              <TableHead>Placed</TableHead>
              {/* Action overlay column — zero width, no bg. The buttons in
                  each body row float over the right edge on hover, so this
                  header allocates no space and adds no visible column. */}
              <TableHead className="w-0 p-0"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((trade) => {
              const cfg = getTradeStatusDisplay(trade.status);
              const timeLabel = cfg.timeLabel({
                placedAt: trade.placedAt,
                filledAt: trade.filledAt,
                closedAt: trade.closedAt,
              });
              const shortId = shortAlpacaId(trade.alpacaOrderId);
              // Trade-as-Proposal — when set, this trade is an Order(AWAITING_APPROVAL)
              // not a real position yet (for buys) or a pending close (for sells).
              // The P&L slot gets [Approve][Reject] buttons; the status dot turns amber.
              // See docs/plans/TRADE_AS_PROPOSAL.md.
              const awaitingApproval = trade.pendingProposal != null;
              const isOpen = trade.status === 'OPEN' || trade.status === 'PENDING';
              const isPending = trade.status === 'PENDING';
              const isStalePrice = trade.priceSource === 'missing' && !awaitingApproval;
              const shares = trade.shares ?? 1;
              const totalValue = trade.currentPrice * shares;
              const totalGain = trade.pnl;
              const totalGainPct = trade.pnlPct;
              const isUp = totalGain >= 0;

              return (
                <TableRow
                  key={trade.id}
                  className="group relative cursor-pointer"
                  onClick={() => router.push(`/trades/${trade.id}`)}
                >
                  {/* Name: logo + ticker with inline status dot + analyst
                      subhead. No longer wrapped in a Link — navigation
                      happens via the hover-revealed action buttons on the
                      right so the Target column's tick bar + tooltips
                      stay interactive (hover on the stop/target ticks
                      wasn't possible under a row-spanning <a>). */}
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-2.5">
                      <StockLogo ticker={trade.ticker} size="sm" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium leading-tight">{trade.ticker}</span>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  className={cn(
                                    'h-1.5 w-1.5 rounded-full shrink-0 cursor-default',
                                    awaitingApproval ? 'bg-amber-500' : cfg.dotClass,
                                  )}
                                  aria-label={awaitingApproval ? 'Pending review' : cfg.label}
                                />
                              }
                            />
                            <TooltipContent side="top">
                              <div>
                                <div>
                                  {awaitingApproval ? 'Pending your approval' : `${cfg.label} · ${timeLabel}`}
                                </div>
                                {shortId && (
                                  <div className="opacity-60 font-mono text-[10px]">Alpaca {shortId}</div>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {trade.analystName && (
                          <p className="text-[10px] text-muted-foreground font-mono leading-tight">
                            {trade.analystName}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  {/* Entry Price */}
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    ${trade.entryPrice.toFixed(2)}
                  </TableCell>

                  {/* Current Price */}
                  <TableCell className="text-right tabular-nums text-sm">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="inline-flex items-center gap-1 cursor-default">
                            {isStalePrice && isOpen && (
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                            )}
                            ${trade.currentPrice.toFixed(2)}
                          </span>
                        }
                      />
                      <TooltipContent side="bottom">
                        <div>
                          {trade.priceSource === 'alpaca' && (
                            <div>Live via Alpaca{trade.priceUpdatedAt && ` · ${formatExactTime(trade.priceUpdatedAt)}`}</div>
                          )}
                          {trade.priceSource === 'finnhub' && (
                            <div>Via Finnhub{trade.priceUpdatedAt && ` · ${formatExactTime(trade.priceUpdatedAt)}`}</div>
                          )}
                          {(trade.priceSource === 'missing' || trade.priceSource === undefined) && isOpen && (
                            <div>No live price — showing entry ${trade.entryPrice.toFixed(2)}</div>
                          )}
                          {!isOpen && <div>Closing price</div>}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>

                  {/* P&L — unified PriceChange component (same arrow+color
                      language as the dashboard header). Em-dash when we
                      don't have a live price to compute against.
                      Trade-as-Proposal: when this row is awaiting approval,
                      replace P&L with the inline [Approve][Reject] action
                      pair so the user can decide without leaving the table. */}
                  <TableCell className="text-right">
                    {awaitingApproval ? (
                      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <ProposalActions orderId={trade.pendingProposal!.orderId} />
                      </div>
                    ) : isStalePrice && isOpen ? (
                      <span className="text-sm text-muted-foreground/60">—</span>
                    ) : (
                      <PriceChange
                        dollarChange={totalGain}
                        percentChange={totalGainPct}
                        size="sm"
                        className="justify-end"
                      />
                    )}
                  </TableCell>

                  {/* Quantity */}
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {shares}
                  </TableCell>

                  {/* Total Value */}
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    ${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </TableCell>

                  {/* Target — PriceGauge tick-bar (same design as the
                      ThesisSheet). Summarizes entry / stop / target /
                      current-price in one glance. Hover reveals the
                      three price labels so users can read exact numbers
                      without clicking into the trade detail page. */}
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <div className="cursor-default">
                            <PriceGauge
                              entry={trade.entryPrice}
                              target={trade.targetPrice}
                              stop={trade.stopPrice}
                              current={trade.currentPrice}
                              direction={trade.direction === 'LONG' ? 'LONG' : 'SHORT'}
                              height={12}
                            />
                          </div>
                        }
                      />
                      <TooltipContent side="top" className="text-xs tabular-nums">
                        {/* One legend row per level, each carrying the SAME
                            marker colour the gauge draws, sorted by price so
                            the list reads left-to-right like the bar itself.
                            Current is drawn as an outline: the gauge paints it
                            `bg-foreground`, and this tooltip's own surface is
                            bg-foreground — a solid dot was invisible on it. */}
                        <div className="space-y-0.5">
                          {[
                            { label: 'Stop', value: trade.stopPrice, marker: 'bg-negative' },
                            { label: 'Entry', value: trade.entryPrice, marker: 'bg-muted-foreground' },
                            { label: 'Current', value: trade.currentPrice, marker: 'border border-current' },
                            { label: 'Target', value: trade.targetPrice, marker: 'bg-positive' },
                          ]
                            .sort((a, b) => a.value - b.value)
                            .map((lvl) => (
                              <div key={lvl.label} className="flex items-center gap-2">
                                <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', lvl.marker)} />
                                {lvl.label} ${lvl.value.toFixed(2)}
                              </div>
                            ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>

                  {/* Time placed — tooltip shows full placed/filled timeline */}
                  <TableCell className="text-sm text-muted-foreground">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="cursor-default">
                            {formatRelativeTime(trade.placedAt ?? trade.openedAt)}
                          </span>
                        }
                      />
                      <TooltipContent side="bottom">
                        <div>
                          {trade.placedAt && <div>Ordered {formatExactTime(trade.placedAt)}</div>}
                          {trade.filledAt
                            ? <div>Filled {formatExactTime(trade.filledAt)}</div>
                            : isPending
                              ? <div className="text-amber-500">Awaiting fill</div>
                              : null}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>

                  {/* Hover-revealed action group. The cell is zero-width
                      (w-0 p-0) and sticky to the viewport right, so it
                      allocates no column space and adds no visible column.
                      The buttons are absolutely positioned (out of flow, so
                      they never widen the cell) and float over the right edge
                      of the row only on hover — no background, no crop. */}
                  <TableCell className="w-0 p-0 sticky right-0">
                    <div
                      className="absolute inset-y-0 right-0 pr-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Link
                              href={`/trades/${trade.id}`}
                              className="h-7 w-7 flex items-center justify-center rounded-md border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                              aria-label="Open trade details"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          }
                        />
                        <TooltipContent side="top">Open trade</TooltipContent>
                      </Tooltip>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="h-7 w-7 flex items-center justify-center rounded-md border bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                          aria-label="More actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem>
                            <Link href={`/trades/${trade.id}`} className="w-full">
                              View details
                            </Link>
                          </DropdownMenuItem>
                          {isOpen && !awaitingApproval && (
                            <>
                              <DropdownMenuItem
                                className="text-amber-500 focus:text-amber-500"
                                onClick={() => setCancelTarget(trade.id)}
                              >
                                Cancel order
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-negative focus:text-negative"
                                onClick={() => setCloseTarget(trade.id)}
                              >
                                Close trade
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      )}

      {filtered.length > 0 && isFiltered && (
        <p className="text-xs text-muted-foreground tabular-nums px-6 py-3">
          Showing {filtered.length} of {allTrades.length} trades
        </p>
      )}

      {/* Close confirmation dialog */}
      <Dialog
        open={!!closeTarget}
        onOpenChange={(open) => {
          if (!open) setCloseTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Close Trade — {closeTargetTrade?.ticker}</DialogTitle>
            <DialogDescription>
              This will manually close the position at the current market price.
              The realized P&amp;L will be recorded and the trade marked as closed.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCloseTarget(null)}
              disabled={closeLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCloseTrade}
              disabled={closeLoading}
              className="gap-2"
            >
              {closeLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {closeLoading ? 'Closing…' : 'Close Trade'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel order dialog */}
      <Dialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Cancel Order — {cancelTargetTrade?.ticker}</DialogTitle>
            <DialogDescription>
              This will cancel the pending Alpaca order and mark the trade as
              cancelled. Use this for orders that haven&apos;t been filled yet
              (e.g. submitted after market close).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelTarget(null)}
              disabled={cancelLoading}
            >
              Keep Order
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelTrade}
              disabled={cancelLoading}
              className="gap-2"
            >
              {cancelLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {cancelLoading ? 'Cancelling…' : 'Cancel Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
