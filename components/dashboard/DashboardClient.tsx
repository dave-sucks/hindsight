'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bot, Sparkles, TrendingUp } from 'lucide-react';
import {
  mockOpenTrades,
  mockEquityCurve,
  mockPortfolio,
  type MockTrade,
} from '@/lib/mock-data/trades';
import type { DashboardData, TodaysPick } from '@/lib/actions/portfolio.actions';
import type { DashboardRun } from '@/lib/actions/analyst.actions';
import { useTradeRealtime, type RealtimeTrade } from '@/hooks/useTradeRealtime';
import { toast } from 'sonner';
import { ThesisCard, type ThesisCardProfile } from '@/components/ThesisCard';

// ─── Relative time helper ────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

// ─── StatChip ────────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  positive,
  loading,
}: {
  label: string;
  value: string;
  positive?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[120px]">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="h-7 w-28" />
      ) : (
        <p
          className={`text-xl font-semibold tabular-nums ${
            positive === true
              ? 'text-emerald-500'
              : positive === false
              ? 'text-red-500'
              : 'text-foreground'
          }`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

// ─── EmptyRail ───────────────────────────────────────────────────────────────

function EmptyRail({ text, subtext }: { text: string; subtext?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2">
      <TrendingUp className="h-7 w-7 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground text-center">{text}</p>
      {subtext && (
        <p className="text-xs text-muted-foreground/60 text-center">{subtext}</p>
      )}
    </div>
  );
}

// ─── TradeListItem ────────────────────────────────────────────────────────────

function TradeListItem({
  trade,
  flash,
}: {
  trade: MockTrade;
  flash?: 'win' | 'loss';
}) {
  const pnl = trade.pnl ?? 0;
  const positive = pnl >= 0;
  const isOpen = trade.status === 'OPEN';
  const timeDate = isOpen
    ? new Date(trade.openedAt)
    : new Date(trade.closedAt ?? trade.openedAt);

  return (
    <Link href={`/trades/${trade.id}`}>
      <div
        className={`flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-accent/50 transition-colors ${
          flash === 'win'
            ? 'bg-emerald-500/10'
            : flash === 'loss'
            ? 'bg-red-500/10'
            : ''
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-muted-foreground">
              {trade.ticker.slice(0, 2)}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">{trade.ticker}</span>
              <Badge
                variant={trade.direction === 'LONG' ? 'default' : 'outline'}
                className="text-[10px] h-4 px-1 py-0"
              >
                {trade.direction}
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              ${trade.entryPrice.toFixed(2)} ·{' '}
              {isOpen ? 'opened' : 'closed'} {formatRelativeTime(timeDate)}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p
            className={`text-sm font-medium tabular-nums ${
              positive ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            {positive ? '+' : ''}${Math.abs(pnl).toFixed(2)}
          </p>
          <p
            className={`text-xs tabular-nums ${
              positive ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            {positive ? '+' : ''}
            {(trade.pnlPct ?? 0).toFixed(2)}%
          </p>
        </div>
      </div>
    </Link>
  );
}

// ─── RunListItem ──────────────────────────────────────────────────────────────

function RunListItem({ run }: { run: DashboardRun }) {
  const href = run.analystId
    ? `/analysts/${run.analystId}?tab=runs`
    : '/analysts';

  return (
    <Link href={href}>
      <div className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-accent/50 transition-colors">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {run.analystName ?? 'Manual Research'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {run.theses.length} thesis{run.theses.length !== 1 ? 'es' : ''} ·{' '}
              {run.theses.filter((t) => t.trade).length} trade
              {run.theses.filter((t) => t.trade).length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {formatRelativeTime(new Date(run.startedAt))}
        </p>
      </div>
    </Link>
  );
}

// ─── RightRailTabs ────────────────────────────────────────────────────────────

function RightRailTabs({
  openTrades,
  closedTrades,
  recentRuns,
  flashIds,
}: {
  openTrades: MockTrade[];
  closedTrades: MockTrade[];
  recentRuns: DashboardRun[];
  flashIds: Map<string, 'win' | 'loss'>;
}) {
  return (
    <Tabs defaultValue="open" className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-3 pt-3 pb-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          Positions
        </p>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="open" className="text-xs">
            Open ({openTrades.length})
          </TabsTrigger>
          <TabsTrigger value="closed" className="text-xs">
            Closed
          </TabsTrigger>
          <TabsTrigger value="runs" className="text-xs">
            Runs
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="open"
        className="flex-1 overflow-y-auto px-3 pb-3 mt-2 data-[state=inactive]:hidden"
      >
        {openTrades.length === 0 ? (
          <EmptyRail
            text="No open trades"
            subtext="Run an analyst to generate theses and place trades."
          />
        ) : (
          openTrades.map((t) => (
            <TradeListItem key={t.id} trade={t} flash={flashIds.get(t.id)} />
          ))
        )}
      </TabsContent>

      <TabsContent
        value="closed"
        className="flex-1 overflow-y-auto px-3 pb-3 mt-2 data-[state=inactive]:hidden"
      >
        {closedTrades.length === 0 ? (
          <EmptyRail text="No closed trades yet" />
        ) : (
          closedTrades.map((t) => <TradeListItem key={t.id} trade={t} />)
        )}
      </TabsContent>

      <TabsContent
        value="runs"
        className="flex-1 overflow-y-auto px-3 pb-3 mt-2 data-[state=inactive]:hidden"
      >
        {recentRuns.length === 0 ? (
          <EmptyRail
            text="No runs yet"
            subtext="Create an analyst in Settings to start research."
          />
        ) : (
          recentRuns.map((r) => <RunListItem key={r.id} run={r} />)
        )}
      </TabsContent>
    </Tabs>
  );
}

// ─── TodaysPicksSection ───────────────────────────────────────────────────────

type PickFilter = 'all' | 'open' | 'passed';

function RecentPicksSection({ picks, profiles }: { picks: TodaysPick[]; profiles?: Record<string, ThesisCardProfile> }) {
  const [filter, setFilter] = useState<PickFilter>('all');

  const filtered = picks.filter((p) => {
    if (filter === 'open') return p.trade?.status === 'OPEN';
    if (filter === 'passed') return p.direction === 'PASS' || p.trade === null;
    return true;
  });

  const chipClass = (active: boolean) =>
    `text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
      active
        ? 'bg-foreground text-background border-foreground'
        : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
    }`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent Picks
        </p>
        <Link
          href="/research"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          All research →
        </Link>
      </div>
      <div className="flex items-center gap-2">
        {(['all', 'open', 'passed'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={chipClass(filter === f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} pick{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <Sparkles className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No {filter} picks today</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((pick) => (
            <ThesisCard key={pick.id} thesis={pick} profile={profiles?.[pick.ticker]} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DashboardRunCard ─────────────────────────────────────────────────────────

function DashboardRunCard({ run }: { run: DashboardRun }) {
  const href = run.analystId
    ? `/analysts/${run.analystId}?tab=runs`
    : '/analysts';

  return (
    <Link href={href}>
      <Card className="hover:bg-accent/30 transition-colors cursor-pointer">
        <CardContent className="p-4">
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Bot className="h-3 w-3 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium truncate">
                {run.analystName ?? 'Manual Research'}
              </span>
              <Badge
                variant="secondary"
                className="text-[10px] h-4 px-1.5 shrink-0"
              >
                {run.source}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-2">
              {formatRelativeTime(new Date(run.startedAt))}
            </span>
          </div>

          {/* Ticker pills */}
          {run.theses.length === 0 ? (
            <p className="text-xs text-muted-foreground">No theses generated</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {run.theses.map((thesis, i) => {
                const dirClass =
                  thesis.direction === 'LONG'
                    ? 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-400'
                    : thesis.direction === 'SHORT'
                    ? 'text-red-600 border-red-500/30 bg-red-500/10 dark:text-red-400'
                    : 'text-muted-foreground border-border bg-muted/50';
                return (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums ${dirClass}`}
                  >
                    {thesis.ticker}
                    <span className="opacity-60">{thesis.confidenceScore}%</span>
                  </span>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── DashboardClient ──────────────────────────────────────────────────────────

interface DashboardClientProps {
  data?: DashboardData;
  recentRuns?: DashboardRun[];
  userId?: string;
  profiles?: Record<string, ThesisCardProfile>;
}

export default function DashboardClient({
  data,
  recentRuns = [],
  userId,
  profiles,
}: DashboardClientProps) {
  const [realtimeClosedIds, setRealtimeClosedIds] = useState<Set<string>>(
    new Set()
  );
  const [flashIds, setFlashIds] = useState<Map<string, 'win' | 'loss'>>(
    new Map()
  );

  const handleTradeUpdate = useCallback((trade: RealtimeTrade) => {
    if (trade.status === 'CLOSED' || trade.status.startsWith('CLOSED_')) {
      const result = trade.outcome === 'WIN' ? 'win' : 'loss';
      setFlashIds((prev) => new Map(prev).set(trade.id, result));
      toast[result === 'win' ? 'success' : 'error'](
        `${trade.ticker} closed — ${result === 'win' ? '✅ WIN' : '❌ LOSS'}`,
        {
          description:
            trade.realizedPnl != null
              ? `P&L: $${trade.realizedPnl.toFixed(2)}`
              : undefined,
        }
      );
      setTimeout(() => {
        setFlashIds((prev) => {
          const m = new Map(prev);
          m.delete(trade.id);
          return m;
        });
        setRealtimeClosedIds((prev) => new Set(prev).add(trade.id));
      }, 1200);
    }
  }, []);

  useTradeRealtime({ userId: userId ?? '', onTradeUpdate: handleTradeUpdate });

  // ── Derived data ─────────────────────────────────────────────────────────────
  const openTrades = (data?.openTrades ?? mockOpenTrades).filter(
    (t) => !realtimeClosedIds.has(t.id)
  );
  const closedTrades = data?.closedTrades ?? [];
  const equityData =
    data && data.equityCurve.length > 0 ? data.equityCurve : mockEquityCurve;
  const portfolio = data?.portfolio ?? {
    totalValue: mockPortfolio.totalValue,
    unrealizedPnl: mockPortfolio.dayChange,
    realizedPnl: mockPortfolio.totalPnl,
    winRate: 0.6,
    openCount: mockOpenTrades.length,
  };

  // Derived display values
  const totalValueStr = portfolio.totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const unrealizedPnl = portfolio.unrealizedPnl;
  const dayPositive = unrealizedPnl >= 0;
  const unrealizedPct =
    portfolio.totalValue > 0
      ? (unrealizedPnl / (portfolio.totalValue - unrealizedPnl)) * 100
      : 0;
  const winRateStr =
    portfolio.winRate != null
      ? `${(portfolio.winRate * 100).toFixed(0)}%`
      : '—';
  const equityPositive =
    equityData.length > 0
      ? equityData[equityData.length - 1].value >= equityData[0].value
      : true;
  const strokeColor = equityPositive ? '#10b981' : '#ef4444';

  return (
    <div className="flex h-[calc(100dvh-5.25rem)] overflow-hidden">
      {/* ── LEFT COLUMN ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-6 pt-6 pb-10 max-w-3xl mx-auto space-y-6">
          {/* Portfolio header + equity curve */}
          <Card>
            <CardContent className="pt-6">
              {/* Stat chips */}
              <div className="flex flex-wrap gap-6 mb-6">
                <StatChip label="Portfolio Value" value={`$${totalValueStr}`} />
                <StatChip
                  label="Unrealized P&L"
                  value={`${dayPositive ? '+' : ''}$${Math.abs(
                    unrealizedPnl
                  ).toFixed(2)} (${dayPositive ? '+' : ''}${unrealizedPct.toFixed(
                    2
                  )}%)`}
                  positive={dayPositive}
                />
                <StatChip label="Win Rate" value={winRateStr} />
                <StatChip
                  label="Open Positions"
                  value={String(portfolio.openCount)}
                />
              </div>

              {/* Equity curve */}
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart
                  data={equityData}
                  margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="equityGrad"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={strokeColor}
                        stopOpacity={0.15}
                      />
                      <stop
                        offset="95%"
                        stopColor={strokeColor}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: 'var(--popover-foreground)',
                    }}
                    formatter={(v) => [
                      `$${Number(v).toLocaleString()}`,
                      'Portfolio Value',
                    ]}
                    labelStyle={{ color: 'var(--muted-foreground)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={strokeColor}
                    strokeWidth={1.5}
                    fill="url(#equityGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: strokeColor }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Today's Picks */}
          <RecentPicksSection picks={data?.todaysPicks ?? []} profiles={profiles} />
        </div>
      </div>

      {/* ── RIGHT COLUMN ────────────────────────────────────────────────────── */}
      <div className="hidden lg:flex w-80 border-l flex-col overflow-hidden shrink-0">
        <RightRailTabs
          openTrades={openTrades}
          closedTrades={closedTrades}
          recentRuns={recentRuns}
          flashIds={flashIds}
        />
      </div>
    </div>
  );
}
