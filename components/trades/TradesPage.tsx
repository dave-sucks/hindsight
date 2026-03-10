'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { closeTrade } from '@/lib/actions/closeTrade.actions';
import {
  mockOpenTrades,
  mockClosedTrades,
  type MockTrade,
  type TradeDirection,
  type TradeStatus,
} from '@/lib/mock-data/trades';
import { ArrowLeftRight, Loader2, TrendingUp, TrendingDown } from 'lucide-react';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TradesPageProps {
  initialOpenTrades?: MockTrade[];
  initialClosedTrades?: MockTrade[];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterStatus = 'ALL' | 'ACTIVE' | 'CLOSED';
type FilterDirection = 'ALL' | TradeDirection;

// ─── Badge helpers ─────────────────────────────────────────────────────────────

function DirectionBadge({ direction }: { direction: TradeDirection }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs font-semibold tabular-nums',
        direction === 'LONG'
          ? 'border-primary/50 text-primary'
          : 'border-amber-500/50 text-amber-500'
      )}
    >
      {direction}
    </Badge>
  );
}

const STATUS_CONFIG: Record<TradeStatus, { label: string; cls: string; live?: boolean }> = {
  OPEN: { label: 'Open', cls: 'border-primary/40 text-primary', live: true },
  CLOSED_WIN: { label: 'Target Hit', cls: 'border-emerald-500/40 text-emerald-500' },
  CLOSED_LOSS: { label: 'Stop Hit', cls: 'border-red-500/40 text-red-500' },
  CLOSED_EXPIRED: { label: 'Expired', cls: 'border-muted-foreground/40 text-muted-foreground' },
};

function StatusBadge({ status }: { status: TradeStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: '' };
  return (
    <Badge variant="outline" className={cn('text-xs', cfg.cls)}>
      {cfg.live && (
        <span className="relative flex h-1.5 w-1.5 mr-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
        </span>
      )}
      {cfg.label}
    </Badge>
  );
}

// ─── Trade card ───────────────────────────────────────────────────────────────

function TradeCard({
  trade,
  onClose,
}: {
  trade: MockTrade;
  onClose: (id: string) => void;
}) {
  const isOpen = trade.status === 'OPEN';
  const isPos = trade.pnl >= 0;

  const gainPct =
    trade.targetPrice && trade.entryPrice
      ? (((trade.targetPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(1)
      : null;
  const lossPct =
    trade.stopPrice && trade.entryPrice
      ? (((trade.entryPrice - trade.stopPrice) / trade.entryPrice) * 100).toFixed(1)
      : null;

  const openedLabel = new Date(trade.openedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <Card className="relative hover:border-foreground/25 transition-colors overflow-hidden">
      {/* Stretched link fills the card — sits below interactive elements */}
      <Link
        href={`/trades/${trade.id}`}
        className="absolute inset-0 z-0"
        aria-label={`View ${trade.ticker} trade`}
      />
      <CardContent className="p-4 space-y-3 relative">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold font-mono">{trade.ticker}</span>
            <DirectionBadge direction={trade.direction} />
          </div>
          <StatusBadge status={trade.status} />
        </div>

        {/* P&L */}
        <div>
          <p
            className={cn(
              'text-2xl font-semibold tabular-nums leading-none',
              isPos ? 'text-emerald-500' : 'text-red-500'
            )}
          >
            {isPos ? '+' : ''}${Math.abs(trade.pnl).toFixed(2)}
          </p>
          <p
            className={cn(
              'text-xs tabular-nums mt-1 flex items-center gap-1',
              isPos ? 'text-emerald-500/70' : 'text-red-500/70'
            )}
          >
            {isPos ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {isPos ? '+' : ''}
            {trade.pnlPct.toFixed(2)}%
          </p>
        </div>

        {/* 4-stat grid */}
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-muted/40 p-2.5 text-center">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
              Entry
            </p>
            <p className="text-xs tabular-nums font-medium">
              ${trade.entryPrice.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
              Target
            </p>
            <p className="text-xs tabular-nums font-medium text-emerald-500">
              ${trade.targetPrice.toFixed(2)}
              {gainPct && (
                <span className="text-[10px] text-muted-foreground ml-0.5">
                  +{gainPct}%
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
              Stop
            </p>
            <p className="text-xs tabular-nums font-medium text-red-500">
              ${trade.stopPrice.toFixed(2)}
              {lossPct && (
                <span className="text-[10px] text-muted-foreground ml-0.5">
                  −{lossPct}%
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
              Conf
            </p>
            <p
              className={cn(
                'text-xs tabular-nums font-medium',
                trade.confidenceScore >= 70 ? 'text-emerald-500' : 'text-amber-500'
              )}
            >
              {trade.confidenceScore}%
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{openedLabel}</p>
          {isOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="relative z-10 h-7 text-xs px-2 text-red-500 hover:text-red-500 hover:bg-red-500/10"
              onClick={(e) => {
                e.preventDefault();
                onClose(trade.id);
              }}
            >
              Close
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
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

  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');
  const [dirFilter, setDirFilter] = useState<FilterDirection>('ALL');
  const [closeTarget, setCloseTarget] = useState<string | null>(null);
  const [closeLoading, setCloseLoading] = useState(false);

  const closeTargetTrade = allTrades.find((t) => t.id === closeTarget);

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

  const filtered = useMemo(() => {
    let trades = allTrades;
    if (statusFilter === 'ACTIVE') trades = trades.filter((t) => t.status === 'OPEN');
    else if (statusFilter === 'CLOSED') trades = trades.filter((t) => t.status !== 'OPEN');
    if (dirFilter !== 'ALL') trades = trades.filter((t) => t.direction === dirFilter);
    return trades;
  }, [allTrades, statusFilter, dirFilter]);

  const isFiltered = statusFilter !== 'ALL' || dirFilter !== 'ALL';

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Paper Trades</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {allTrades.length} trade{allTrades.length !== 1 ? 's' : ''} ·{' '}
          <span className="text-foreground tabular-nums">{openTrades.length} open</span>
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {(['ALL', 'ACTIVE', 'CLOSED'] as FilterStatus[]).map((f) => (
          <Button
            key={f}
            variant={statusFilter === f ? 'secondary' : 'outline'}
            size="sm"
            className={cn(
              'h-8 text-xs',
              statusFilter !== f && 'text-muted-foreground'
            )}
            onClick={() => setStatusFilter(f)}
          >
            {f === 'ALL'
              ? `All (${allTrades.length})`
              : f === 'ACTIVE'
              ? `Open (${openTrades.length})`
              : `Closed (${closedTrades.length})`}
          </Button>
        ))}

        <div className="h-5 w-px bg-border mx-1" />

        {(['ALL', 'LONG', 'SHORT'] as FilterDirection[]).map((d) => (
          <Button
            key={d}
            variant={dirFilter === d ? 'secondary' : 'outline'}
            size="sm"
            className={cn(
              'h-8 text-xs',
              dirFilter !== d && 'text-muted-foreground'
            )}
            onClick={() => setDirFilter(d)}
          >
            {d === 'ALL' ? 'All Directions' : d}
          </Button>
        ))}
      </div>

      {/* Card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <EmptyState filtered={isFiltered} />
        ) : (
          filtered.map((trade) => (
            <TradeCard
              key={trade.id}
              trade={trade}
              onClose={(id) => setCloseTarget(id)}
            />
          ))
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">
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
    </div>
  );
}
