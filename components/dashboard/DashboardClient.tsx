'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  mockOpenTrades,
  mockClosedTrades,
  mockPortfolio,
  mockEquityCurve,
  mockWatchlist,
  type MockTrade,
} from '@/lib/mock-data/trades';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const TIME_RANGES = ['1D', '1W', '1M', '3M', 'YTD', 'ALL'] as const;
type TimeRange = (typeof TIME_RANGES)[number];

function formatCurrency(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function formatPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function PnlCell({ pnl, pnlPct }: { pnl: number; pnlPct: number }) {
  const isPos = pnl >= 0;
  return (
    <div className={cn('tabular-nums', isPos ? 'text-emerald-500' : 'text-red-500')}>
      <div className="font-medium">{isPos ? '+' : ''}{formatCurrency(pnl)}</div>
      <div className="text-xs opacity-75">{formatPct(pnlPct)}</div>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: MockTrade['direction'] }) {
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

function StatusBadge({ status }: { status: MockTrade['status'] }) {
  const map = {
    OPEN: 'border-primary/40 text-primary',
    CLOSED_WIN: 'border-emerald-500/40 text-emerald-500',
    CLOSED_LOSS: 'border-red-500/40 text-red-500',
  } as const;
  const labels = { OPEN: 'Open', CLOSED_WIN: 'Win', CLOSED_LOSS: 'Loss' } as const;
  return (
    <Badge variant="outline" className={cn('text-xs', map[status])}>
      {labels[status]}
    </Badge>
  );
}

function TradesTable({ trades, dimmed = false }: { trades: MockTrade[]; dimmed?: boolean }) {
  if (trades.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        No trades yet — research a stock to place your first paper trade.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border hover:bg-transparent">
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ticker</TableHead>
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dir</TableHead>
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">Entry</TableHead>
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">Current</TableHead>
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">Target</TableHead>
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">Stop</TableHead>
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conf</TableHead>
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">P&L</TableHead>
          <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => (
          <TableRow
            key={trade.id}
            className={cn(
              'border-border cursor-pointer transition-colors hover:bg-secondary/30',
              dimmed && 'opacity-60'
            )}
          >
            <TableCell className="font-semibold text-foreground">{trade.ticker}</TableCell>
            <TableCell><DirectionBadge direction={trade.direction} /></TableCell>
            <TableCell className="tabular-nums text-sm text-muted-foreground">${trade.entryPrice.toFixed(2)}</TableCell>
            <TableCell className="tabular-nums text-sm text-foreground font-medium">${trade.currentPrice.toFixed(2)}</TableCell>
            <TableCell className="tabular-nums text-sm text-muted-foreground">${trade.targetPrice.toFixed(2)}</TableCell>
            <TableCell className="tabular-nums text-sm text-muted-foreground">${trade.stopPrice.toFixed(2)}</TableCell>
            <TableCell>
              <span className="text-xs tabular-nums text-muted-foreground">{trade.confidenceScore}%</span>
            </TableCell>
            <TableCell><PnlCell pnl={trade.pnl} pnlPct={trade.pnlPct} /></TableCell>
            <TableCell><StatusBadge status={trade.status} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TradesTableSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function EquityTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 text-sm shadow-lg">
      <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
      <p className="font-semibold text-foreground tabular-nums">
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
}

export default function DashboardClient() {
  const [activeRange, setActiveRange] = useState<TimeRange>('1M');
  const [isLoading] = useState(false);

  const { totalValue, dayChange, dayChangePct } = mockPortfolio;
  const isDayPos = dayChange >= 0;

  return (
    <div className="p-6 space-y-6">
      {/* Page title */}
      <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ── Left column (2/3) ── */}
        <div className="xl:col-span-2 space-y-6">
          {/* Portfolio header — 3 stat cards */}
          <div className="grid grid-cols-3 gap-4">
            {/* Total value */}
            <Card className="border-border p-6 col-span-3 sm:col-span-1">
              <CardContent className="p-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Portfolio Value
                </p>
                {isLoading ? (
                  <Skeleton className="h-8 w-36" />
                ) : (
                  <p className="text-2xl font-semibold text-foreground tabular-nums">
                    {formatCurrency(totalValue)}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* $ change today */}
            <Card className="border-border p-6 col-span-3 sm:col-span-1">
              <CardContent className="p-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Today
                </p>
                {isLoading ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  <p className={cn('text-2xl font-semibold tabular-nums', isDayPos ? 'text-emerald-500' : 'text-red-500')}>
                    {isDayPos ? '+' : ''}{formatCurrency(dayChange)}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* % change today */}
            <Card className="border-border p-6 col-span-3 sm:col-span-1">
              <CardContent className="p-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Today %
                </p>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div className={cn('flex items-center gap-1.5', isDayPos ? 'text-emerald-500' : 'text-red-500')}>
                    {isDayPos ? (
                      <TrendingUp className="h-5 w-5" />
                    ) : (
                      <TrendingDown className="h-5 w-5" />
                    )}
                    <span className="text-2xl font-semibold tabular-nums">
                      {formatPct(dayChangePct)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Equity curve */}
          <Card className="border-border">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-medium">Equity Curve</CardTitle>
              {/* Time range selector */}
              <div className="flex gap-1">
                {TIME_RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setActiveRange(r)}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded transition-colors',
                      activeRange === r
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-52 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={mockEquityCurve} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      interval={4}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      width={48}
                    />
                    <Tooltip content={<EquityTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#equityGradient)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Active Trades */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg font-medium">
                Active Trades
                <Badge variant="secondary" className="ml-2 tabular-nums text-xs">
                  {mockOpenTrades.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {isLoading ? (
                <div className="p-6"><TradesTableSkeleton /></div>
              ) : (
                <TradesTable trades={mockOpenTrades} />
              )}
            </CardContent>
          </Card>

          {/* Closed Trades */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg font-medium text-muted-foreground">
                Closed Trades
                <Badge variant="outline" className="ml-2 tabular-nums text-xs text-muted-foreground">
                  {mockClosedTrades.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {isLoading ? (
                <div className="p-6"><TradesTableSkeleton /></div>
              ) : (
                <TradesTable trades={mockClosedTrades} dimmed />
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right column (1/3) ── */}
        <div className="xl:col-span-1 space-y-6">
          {/* Quick stats */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-medium">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Open Positions', value: mockOpenTrades.length, unit: '' },
                { label: 'Win Rate', value: '60', unit: '%' },
                { label: 'Avg Confidence', value: '74', unit: '%' },
                { label: 'Total P&L', value: '+$127', unit: '' },
              ].map(({ label, value, unit }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {value}{unit}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Watchlist */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-medium">Watchlist</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[340px]">
                {mockWatchlist.map((item, i) => {
                  const isPos = item.changePct >= 0;
                  return (
                    <div key={item.ticker}>
                      <div className="flex items-center justify-between px-6 py-3 hover:bg-secondary/30 transition-colors cursor-pointer">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{item.ticker}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.name}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-medium tabular-nums text-foreground">
                            ${item.price.toFixed(2)}
                          </p>
                          <p className={cn('text-xs tabular-nums', isPos ? 'text-emerald-500' : 'text-red-500')}>
                            {isPos ? '+' : ''}{item.changePct.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                      {i < mockWatchlist.length - 1 && <Separator />}
                    </div>
                  );
                })}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
