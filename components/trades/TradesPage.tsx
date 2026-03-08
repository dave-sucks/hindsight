'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  mockOpenTrades,
  mockClosedTrades,
  type MockTrade,
  type TradeDirection,
  type TradeStatus,
} from '@/lib/mock-data/trades';
import {
  ChevronUp,
  ChevronDown,
  Download,
  ArrowLeftRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterStatus = 'ALL' | 'ACTIVE' | 'CLOSED';
type FilterDirection = 'ALL' | TradeDirection;
type SortKey = keyof MockTrade;
type SortDir = 'asc' | 'desc';

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

const STATUS_CONFIG: Record<
  TradeStatus,
  { label: string; cls: string }
> = {
  OPEN: { label: 'Active', cls: 'border-primary/40 text-primary' },
  CLOSED_WIN: { label: 'Target Hit', cls: 'border-emerald-500/40 text-emerald-500' },
  CLOSED_LOSS: { label: 'Stop Hit', cls: 'border-red-500/40 text-red-500' },
  CLOSED_EXPIRED: { label: 'Expired', cls: 'border-muted-foreground/40 text-muted-foreground' },
};

function StatusBadge({ status }: { status: TradeStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: '' };
  return (
    <Badge variant="outline" className={cn('text-xs', cfg.cls)}>
      {cfg.label}
    </Badge>
  );
}

// ─── Duration helper ───────────────────────────────────────────────────────────

function tradeDuration(openedAt: string, closedAt?: string): string {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const diffMs = end - start;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days === 0) return `${hours}h`;
  return `${days}d ${hours}h`;
}

// ─── Sortable header ──────────────────────────────────────────────────────────

function SortableHead({
  col,
  label,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  col: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <TableHead
      className={cn(
        'text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors',
        className
      )}
      onClick={() => onSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronDown className="h-3 w-3 opacity-20" />
        )}
      </span>
    </TableHead>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function TradesTableSkeleton() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <TableRow key={i} className="border-border">
          {[...Array(11)].map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full max-w-[80px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TradesPage() {
  const allTrades = [...mockOpenTrades, ...mockClosedTrades];

  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');
  const [dirFilter, setDirFilter] = useState<FilterDirection>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('openedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [isLoading] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filtered = useMemo(() => {
    let trades = allTrades;

    if (statusFilter === 'ACTIVE') trades = trades.filter((t) => t.status === 'OPEN');
    else if (statusFilter === 'CLOSED') trades = trades.filter((t) => t.status !== 'OPEN');

    if (dirFilter !== 'ALL') trades = trades.filter((t) => t.direction === dirFilter);

    trades = [...trades].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === undefined || bv === undefined) return 0;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return trades;
  }, [allTrades, statusFilter, dirFilter, sortKey, sortDir]);

  const sortProps = { sortKey, sortDir, onSort: handleSort };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Paper Trades</h1>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => toast.info('Export available in M5')}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status filters */}
        {(['ALL', 'ACTIVE', 'CLOSED'] as FilterStatus[]).map((f) => (
          <Button
            key={f}
            variant={statusFilter === f ? 'secondary' : 'outline'}
            size="sm"
            className={cn(
              'h-8 text-xs',
              statusFilter === f ? 'text-foreground' : 'text-muted-foreground'
            )}
            onClick={() => setStatusFilter(f)}
          >
            {f === 'ALL' ? `All (${allTrades.length})` : f === 'ACTIVE' ? `Active (${mockOpenTrades.length})` : `Closed (${mockClosedTrades.length})`}
          </Button>
        ))}

        <div className="h-5 w-px bg-border mx-1" />

        {/* Direction filters */}
        {(['ALL', 'LONG', 'SHORT'] as FilterDirection[]).map((d) => (
          <Button
            key={d}
            variant={dirFilter === d ? 'secondary' : 'outline'}
            size="sm"
            className={cn(
              'h-8 text-xs',
              dirFilter === d ? 'text-foreground' : 'text-muted-foreground'
            )}
            onClick={() => setDirFilter(d)}
          >
            {d === 'ALL' ? 'All Directions' : d}
          </Button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <Select defaultValue="all-sectors">
            <SelectTrigger className="h-8 w-36 text-xs text-muted-foreground">
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-sectors">All Sectors</SelectItem>
              <SelectItem value="tech">Technology</SelectItem>
              <SelectItem value="finance">Finance</SelectItem>
              <SelectItem value="consumer">Consumer</SelectItem>
            </SelectContent>
          </Select>

          <Select defaultValue="all-time">
            <SelectTrigger className="h-8 w-36 text-xs text-muted-foreground">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-time">All Time</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent bg-secondary/20">
                <SortableHead col="ticker" label="Ticker" {...sortProps} />
                <SortableHead col="direction" label="Dir" {...sortProps} />
                <SortableHead col="entryPrice" label="Entry" {...sortProps} className="tabular-nums" />
                <SortableHead col="currentPrice" label="Current" {...sortProps} className="tabular-nums" />
                <SortableHead col="targetPrice" label="Target" {...sortProps} className="tabular-nums" />
                <SortableHead col="stopPrice" label="Stop" {...sortProps} className="tabular-nums" />
                <SortableHead col="pnl" label="P&L ($)" {...sortProps} className="tabular-nums" />
                <SortableHead col="pnlPct" label="P&L %" {...sortProps} className="tabular-nums" />
                <SortableHead col="confidenceScore" label="Conf" {...sortProps} />
                <SortableHead col="status" label="Status" {...sortProps} />
                <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Duration</TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TradesTableSkeleton />
              ) : filtered.length === 0 ? (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell colSpan={12} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <ArrowLeftRight className="h-8 w-8 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No trades match your filters</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((trade) => {
                  const isOpen = trade.status === 'OPEN';
                  const isPos = trade.pnl >= 0;
                  return (
                    <TableRow
                      key={trade.id}
                      className={cn(
                        'border-border cursor-pointer transition-colors hover:bg-secondary/30',
                        !isOpen && 'opacity-70'
                      )}
                    >
                      <TableCell className="font-semibold text-foreground">{trade.ticker}</TableCell>
                      <TableCell><DirectionBadge direction={trade.direction} /></TableCell>
                      <TableCell className="tabular-nums text-sm text-muted-foreground">${trade.entryPrice.toFixed(2)}</TableCell>
                      <TableCell className="tabular-nums text-sm text-foreground font-medium">${trade.currentPrice.toFixed(2)}</TableCell>
                      <TableCell className="tabular-nums text-sm text-muted-foreground">${trade.targetPrice.toFixed(2)}</TableCell>
                      <TableCell className="tabular-nums text-sm text-muted-foreground">${trade.stopPrice.toFixed(2)}</TableCell>
                      <TableCell className={cn('tabular-nums text-sm font-medium', isPos ? 'text-emerald-500' : 'text-red-500')}>
                        {isPos ? '+' : ''}{trade.pnl.toFixed(2)}
                      </TableCell>
                      <TableCell className={cn('tabular-nums text-sm font-medium', isPos ? 'text-emerald-500' : 'text-red-500')}>
                        {isPos ? '+' : ''}{trade.pnlPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className="tabular-nums text-sm text-muted-foreground">{trade.confidenceScore}%</TableCell>
                      <TableCell><StatusBadge status={trade.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {tradeDuration(trade.openedAt, trade.closedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" render={<Link href={`/trades/${trade.id}/thesis`} />}>
                            Thesis
                          </Button>
                          {isOpen && (
                            <Tooltip>
                              <TooltipTrigger>
                                <span tabIndex={0}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2 opacity-40 cursor-not-allowed"
                                    disabled
                                  >
                                    Close
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Available in M3</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Row count */}
      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">
          Showing {filtered.length} of {allTrades.length} trades
        </p>
      )}
    </div>
  );
}
