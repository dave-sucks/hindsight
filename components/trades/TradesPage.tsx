'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarGauge } from '@/components/ui/bar-gauge';
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
import { PnlBadge } from '@/components/ui/pnl-badge';
import { PnlArrow } from '@/components/ui/pnl-arrow';
import { cn } from '@/lib/utils';
import { closeTrade, cancelTrade } from '@/lib/actions/closeTrade.actions';
import {
  mockOpenTrades,
  mockClosedTrades,
  type MockTrade,
  type TradeStatus,
} from '@/lib/mock-data/trades';
import { ArrowLeftRight, Loader2, MoreHorizontal } from 'lucide-react';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TradesPageProps {
  initialOpenTrades?: MockTrade[];
  initialClosedTrades?: MockTrade[];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'ALL' | 'OPEN' | 'CLOSED' | 'WON' | 'LOST';

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TradeStatus, { label: string; dotClass: string }> = {
  OPEN: { label: 'Open', dotClass: 'bg-positive animate-pulse' },
  CLOSED_WIN: { label: 'Won', dotClass: 'bg-positive' },
  CLOSED_LOSS: { label: 'Loss', dotClass: 'bg-negative' },
  CLOSED_EXPIRED: { label: 'Expired', dotClass: 'bg-muted-foreground/40' },
};

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

// ─── Target progress bar ─────────────────────────────────────────────────────

function TargetDots({
  entry,
  current,
  target,
  stop,
  direction,
}: {
  entry: number;
  current: number;
  target: number;
  stop: number;
  direction: string;
}) {
  const range = target - stop;
  if (range === 0) return null;

  const progress = direction === 'LONG'
    ? (current - stop) / range
    : (stop - current) / range;

  return (
    <BarGauge
      mode="range"
      value={Math.max(0, Math.min(1, progress))}
      size="sm"
    />
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
      <ArrowLeftRight className="h-8 w-8 mb-3 opacity-30" />
      <p className="text-sm">
        {filtered ? 'No trades match your filters' : 'No paper trades yet'}
      </p>
      {!filtered && (
        <p className="text-xs mt-1 max-w-xs leading-relaxed">
          Trades are placed automatically when an analyst finds a high-confidence setup.
        </p>
      )}
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
      case 'OPEN':
        return allTrades.filter((t) => t.status === 'OPEN');
      case 'CLOSED':
        return allTrades.filter((t) => t.status !== 'OPEN');
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
    <div className="space-y-0">
      {/* Header + filter tabs */}
      <div className="px-6 pt-6 pb-4 flex items-center justify-between gap-4">
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

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState filtered={isFiltered} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Day Gain</TableHead>
              <TableHead className="text-right">Total Gain</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Placed</TableHead>
              <TableHead className="text-right">Stop</TableHead>
              <TableHead className="pr-6"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((trade) => {
              const cfg = STATUS_CONFIG[trade.status] ?? { label: trade.status, dotClass: 'bg-muted-foreground/40' };
              const isOpen = trade.status === 'OPEN';
              const shares = trade.shares ?? 1;
              const totalValue = trade.currentPrice * shares;
              const totalGain = trade.pnl;
              const totalGainPct = trade.pnlPct;
              const isUp = totalGain >= 0;

              return (
                <TableRow key={trade.id} className="cursor-pointer">
                  {/* Name: logo + company name + ticker/confidence/analyst subhead */}
                  <TableCell className="pl-6">
                    <Link href={`/trades/${trade.id}`} className="flex items-center gap-2.5">
                      <StockLogo ticker={trade.ticker} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight">{trade.companyName ?? trade.ticker}</p>
                        <p className="text-[10px] text-muted-foreground font-mono leading-tight">
                          {trade.ticker} <span className="opacity-30">·</span> {trade.confidenceScore}%
                          {trade.analystName && (
                            <>
                              <span className="opacity-30"> · </span>
                              {trade.analystName}
                            </>
                          )}
                        </p>
                      </div>
                    </Link>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dotClass}`} />
                      {cfg.label}
                    </span>
                  </TableCell>

                  {/* Current Price */}
                  <TableCell className="text-right tabular-nums text-sm">
                    ${trade.currentPrice.toFixed(2)}
                  </TableCell>

                  {/* Total Value */}
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    ${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </TableCell>

                  {/* Quantity */}
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {shares}
                  </TableCell>

                  {/* Entry Price */}
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    ${trade.entryPrice.toFixed(2)}
                  </TableCell>

                  {/* Day Gain — icon + foreground text */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <PnlArrow direction={isUp ? 'up' : 'down'} className="h-4 w-4" />
                      <span className="text-sm tabular-nums">
                        {isUp ? '+' : ''}${totalGain.toFixed(2)}
                      </span>
                    </div>
                  </TableCell>

                  {/* Total Gain — icon + foreground text + badge */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <PnlArrow direction={isUp ? 'up' : 'down'} className="h-4 w-4" />
                      <span className="text-sm tabular-nums">
                        {isUp ? '+' : ''}${totalGain.toFixed(2)}
                      </span>
                      <PnlBadge value={totalGainPct} />
                    </div>
                  </TableCell>

                  {/* Target dots */}
                  <TableCell>
                    <TargetDots
                      entry={trade.entryPrice}
                      current={trade.currentPrice}
                      target={trade.targetPrice}
                      stop={trade.stopPrice}
                      direction={trade.direction}
                    />
                  </TableCell>

                  {/* Direction — plain Badge component */}
                  <TableCell>
                    <Badge variant="secondary">{trade.direction}</Badge>
                  </TableCell>

                  {/* Time placed — regular text */}
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelativeTime(trade.openedAt)}
                  </TableCell>

                  {/* Stop — muted foreground */}
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    ${trade.stopPrice.toFixed(2)}
                  </TableCell>

                  {/* 3-dot menu */}
                  <TableCell className="pr-6">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent/60 transition-colors text-muted-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                          <Link href={`/trades/${trade.id}`} className="w-full">
                            View details
                          </Link>
                        </DropdownMenuItem>
                        {isOpen && (
                          <>
                            <DropdownMenuItem
                              className="text-amber-500 focus:text-amber-500"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCancelTarget(trade.id);
                              }}
                            >
                              Cancel order
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-negative focus:text-negative"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCloseTarget(trade.id);
                              }}
                            >
                              Close trade
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
