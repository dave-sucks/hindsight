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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { StockLogo } from '@/components/StockLogo';
import { ThesisCard } from '@/components/ThesisCard';
import type { ThesisCardData, ThesisCardProfile } from '@/components/ThesisCard';
import { Bot } from 'lucide-react';
import {
  mockOpenTrades,
  mockEquityCurve,
  mockPortfolio,
  type MockTrade,
} from '@/lib/mock-data/trades';
import type { DashboardData, RecentPick } from '@/lib/actions/portfolio.actions';
import type { DashboardRun } from '@/lib/actions/analyst.actions';
import { useTradeRealtime, type RealtimeTrade } from '@/hooks/useTradeRealtime';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtIsoLabel(d: string): string {
  if (d.length === 10 && d.includes('-')) {
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d;
}

function fmtUsd(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRelativeTime(date: Date): string {
  const d = Date.now() - date.getTime();
  const s = Math.floor(d / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Time range ───────────────────────────────────────────────────────────────

const RANGES = ['1D', '1W', '1M', '1Y', 'Max'] as const;
type Range = (typeof RANGES)[number];

const RANGE_DAYS: Record<Range, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '1Y': 365,
  Max: 99999,
};

function sliceEquity(data: { date: string; value: number }[], range: Range) {
  const cutoffMs = Date.now() - RANGE_DAYS[range] * 86_400_000;
  if (data.length > 0 && data[0].date.length === 10 && data[0].date.includes('-')) {
    const filtered = data.filter((d) => new Date(d.date + 'T12:00:00').getTime() >= cutoffMs);
    return filtered.length > 1 ? filtered : data.slice(-2);
  }
  return data;
}

// ─── Recent pick → ThesisCardData mapper ─────────────────────────────────────

type PickFilter = 'all' | 'open' | 'passed';

function pickToThesisCardData(pick: RecentPick): ThesisCardData {
  return {
    id: pick.id,
    ticker: pick.ticker,
    direction: pick.direction,
    confidenceScore: pick.confidenceScore,
    holdDuration: '',
    signalTypes: pick.signalTypes,
    reasoningSummary: pick.reasoningSummary,
    entryPrice: pick.entryPrice,
    targetPrice: pick.targetPrice,
    stopLoss: pick.stopLoss,
    trade: pick.trade
      ? {
          id: pick.trade.id,
          realizedPnl: null,
          status: pick.trade.status,
          entryPrice: pick.trade.entryPrice,
          closePrice: null,
        }
      : null,
    // Use trade entry time when available so the card shows "entry at 9:02 AM"
    createdAt: pick.trade?.openedAt ?? pick.createdAt,
    currentPrice: pick.currentPrice,
  };
}

function pickToProfile(pick: RecentPick): ThesisCardProfile {
  return {
    name: pick.ticker,
    logo: `https://assets.parqet.com/logos/symbol/${pick.ticker}?format=svg`,
    exchange: '',
  };
}

// ─── Recent picks section ─────────────────────────────────────────────────────

function RecentPicksSection({ picks }: { picks: RecentPick[] }) {
  const [filter, setFilter] = useState<PickFilter>('all');

  const filtered = picks.filter((p) => {
    if (filter === 'open') return p.trade?.status === 'OPEN';
    if (filter === 'passed') return p.trade === null;
    return true;
  });

  const pills: { key: PickFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'passed', label: 'Passed' },
  ];

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent Picks
        </p>
        <div className="flex items-center gap-3">
          {/* Filter pills */}
          <div className="flex items-center gap-1.5">
            {pills.map((pill) => (
              <button
                key={pill.key}
                onClick={() => setFilter(pill.key)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  filter === pill.key
                    ? 'bg-foreground text-background'
                    : 'border text-muted-foreground hover:text-foreground hover:border-foreground/40',
                )}
              >
                {pill.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {filtered.length} pick{filtered.length !== 1 ? 's' : ''}
          </span>
          <Link
            href="/analysts"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            All research →
          </Link>
        </div>
      </div>

      {/* Cards */}
      {picks.length === 0 ? (
        <div className="rounded-lg border px-4 py-10 flex flex-col items-center gap-2">
          <Bot className="h-7 w-7 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground text-center">
            No recent picks — run an analyst to generate theses.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border px-4 py-8 flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground text-center">
            No picks match this filter.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((pick) => (
            <ThesisCard
              key={pick.id}
              thesis={pickToThesisCardData(pick)}
              profile={pickToProfile(pick)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Trade row (for positions card) ──────────────────────────────────────────

function TradeRow({
  trade,
  flash,
}: {
  trade: MockTrade;
  flash?: 'win' | 'loss';
}) {
  const pnl = trade.pnl ?? 0;
  const pct = trade.pnlPct ?? 0;
  const pos = pnl >= 0;

  return (
    <Link
      href={`/trades/${trade.id}`}
      className={cn(
        'flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors border-b border-border/40 last:border-0',
        flash === 'win' && 'bg-emerald-500/5',
        flash === 'loss' && 'bg-red-500/5',
      )}
    >
      <StockLogo ticker={trade.ticker} size="sm" />
      <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium leading-tight">{trade.ticker}</span>
          <span className="text-xs text-muted-foreground">
            ${trade.entryPrice.toFixed(2)} entry
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className="text-sm tabular-nums">${trade.currentPrice.toFixed(2)}</span>
          <span className={cn('text-xs tabular-nums', pos ? 'text-emerald-500' : 'text-red-500')}>
            {pos ? '+' : ''}{pct.toFixed(2)}%
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── Recent research run card (below picks) ───────────────────────────────────

function DashboardRunCard({ run }: { run: DashboardRun }) {
  const href = run.analystId ? `/runs/${run.id}` : '/analysts';

  return (
    <Link
      href={href}
      className="flex items-start gap-3 px-4 py-3 rounded-lg border hover:bg-accent/30 transition-colors"
    >
      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium truncate">
              {run.analystName ?? 'Manual Research'}
            </span>
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
              {run.source}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {formatRelativeTime(new Date(run.startedAt))}
          </span>
        </div>
        {run.theses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No theses generated</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {run.theses.map((thesis, i) => {
              const cls =
                thesis.direction === 'LONG'
                  ? 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10 dark:text-emerald-400'
                  : thesis.direction === 'SHORT'
                    ? 'text-red-600 border-red-500/30 bg-red-500/10 dark:text-red-400'
                    : 'text-muted-foreground border-border bg-muted/50';
              return (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums ${cls}`}
                >
                  {thesis.ticker}
                  <span className="opacity-60">{thesis.confidenceScore}%</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── Empty ────────────────────────────────────────────────────────────────────

function Empty({ text, subtext }: { text: string; subtext?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-1.5 px-4">
      <p className="text-sm text-muted-foreground text-center">{text}</p>
      {subtext && <p className="text-xs text-muted-foreground/60 text-center">{subtext}</p>}
    </div>
  );
}

// ─── DashboardClient ──────────────────────────────────────────────────────────

interface DashboardClientProps {
  data?: DashboardData;
  recentRuns?: DashboardRun[];
  userId?: string;
}

export default function DashboardClient({
  data,
  recentRuns = [],
  userId,
}: DashboardClientProps) {
  const [range, setRange] = useState<Range>('1M');
  const [realtimeClosedIds, setRealtimeClosedIds] = useState<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Map<string, 'win' | 'loss'>>(new Map());

  const handleTradeUpdate = useCallback((trade: RealtimeTrade) => {
    if (trade.status === 'CLOSED' || trade.status.startsWith('CLOSED_')) {
      const result = trade.outcome === 'WIN' ? 'win' : 'loss';
      setFlashIds((prev) => new Map(prev).set(trade.id, result));
      toast[result === 'win' ? 'success' : 'error'](
        `${trade.ticker} closed — ${result === 'win' ? '✅ WIN' : '❌ LOSS'}`,
        {
          description:
            trade.realizedPnl != null ? `P&L: $${trade.realizedPnl.toFixed(2)}` : undefined,
        },
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

  // ── Derived data ────────────────────────────────────────────────────────────
  const openTrades = (data?.openTrades ?? mockOpenTrades).filter(
    (t) => !realtimeClosedIds.has(t.id),
  );
  const closedTrades = data?.closedTrades ?? [];
  const allEquityData =
    data && data.equityCurve.length > 0 ? data.equityCurve : mockEquityCurve;
  const equityData = sliceEquity(allEquityData, range);
  const recentPicks = data?.recentPicks ?? [];

  const portfolio = data?.portfolio ?? {
    totalValue: mockPortfolio.totalValue,
    unrealizedPnl: mockPortfolio.dayChange,
    realizedPnl: mockPortfolio.totalPnl,
    winRate: 0.6,
    openCount: mockOpenTrades.length,
  };

  const totalValueStr = fmtUsd(portfolio.totalValue);
  const unrealizedPnl = portfolio.unrealizedPnl;
  const pnlPositive = unrealizedPnl >= 0;
  const unrealizedPct =
    portfolio.totalValue > 0
      ? (unrealizedPnl / (portfolio.totalValue - unrealizedPnl)) * 100
      : 0;
  const winRateStr =
    portfolio.winRate != null
      ? `${(portfolio.winRate * 100).toFixed(0)}% win rate`
      : null;

  const equityPositive =
    equityData.length > 1
      ? equityData[equityData.length - 1].value >= equityData[0].value
      : true;
  const strokeColor = equityPositive ? '#10b981' : '#ef4444';

  const loading = !data;

  return (
    // ── Scrollable page wrapper — NOT full-height flex sidebar ──────────────
    <div className="overflow-y-auto h-[calc(100dvh-5.25rem)]">
      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* ── 2-col flex: left (content) + right (positions card) ─────────── */}
        <div className="flex gap-6 items-start">

          {/* ══ LEFT column ══════════════════════════════════════════════════ */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Portfolio header */}
            <div className="space-y-1">
              {loading ? (
                <>
                  <Skeleton className="h-10 w-48" />
                  <Skeleton className="h-5 w-56" />
                </>
              ) : (
                <>
                  <p className="text-4xl font-semibold tabular-nums tracking-tight">
                    ${totalValueStr}
                  </p>
                  <p className="text-sm tabular-nums flex items-center gap-1 flex-wrap">
                    <span className={pnlPositive ? 'text-emerald-500' : 'text-red-500'}>
                      {pnlPositive ? '+' : '-'}${Math.abs(unrealizedPnl).toFixed(2)}{' '}
                      ({pnlPositive ? '+' : ''}{unrealizedPct.toFixed(2)}%)
                    </span>
                    {winRateStr && (
                      <>
                        <span className="text-muted-foreground mx-0.5">—</span>
                        <span className="text-muted-foreground">{winRateStr}</span>
                      </>
                    )}
                  </p>
                </>
              )}
            </div>

            {/* Equity chart — dotted bg, inline range tabs */}
            <div
              className="relative rounded-lg overflow-hidden border"
              style={{
                backgroundImage:
                  'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
                backgroundSize: '18px 18px',
                backgroundColor: 'hsl(var(--muted)/0.3)',
              }}
            >
              {/* Range tabs — absolute top-left */}
              <div className="absolute top-3 left-3 z-10 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border px-1 py-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={cn(
                      'px-2 py-0.5 text-xs rounded transition-colors',
                      range === r
                        ? 'bg-foreground text-background font-medium'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="h-52 flex items-center justify-center">
                  <Skeleton className="h-1 w-3/4 rounded-full" />
                </div>
              ) : equityData.length < 2 ? (
                <div className="h-52 flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">No trade history yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={equityData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={strokeColor} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={fmtIsoLabel}
                      interval="preserveStartEnd"
                      padding={{ left: 0, right: 0 }}
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
                      formatter={(v) => [`$${Number(v).toLocaleString()}`, 'Portfolio']}
                      labelFormatter={(l: unknown) => fmtIsoLabel(String(l))}
                      labelStyle={{ color: 'var(--muted-foreground)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={strokeColor}
                      strokeWidth={1.5}
                      fill="url(#eqGrad)"
                      dot={false}
                      activeDot={{ r: 3, fill: strokeColor }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* ── RECENT PICKS (the production thesis card component) ────────── */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 w-full rounded-lg" />)}
              </div>
            ) : (
              <RecentPicksSection picks={recentPicks} />
            )}

            {/* ── Recent research runs ─────────────────────────────────────── */}
            {recentRuns.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recent Runs
                </p>
                <div className="space-y-2">
                  {recentRuns.map((run) => (
                    <DashboardRunCard key={run.id} run={run} />
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* ══ RIGHT column — normal Card (NOT a sidebar) ══════════════════ */}
          <div className="hidden lg:block w-80 shrink-0">
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-base font-medium">Positions</CardTitle>
                <Link
                  href="/trades"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  View all →
                </Link>
              </CardHeader>
              <CardContent className="p-0">
                <Tabs defaultValue="open">
                  <TabsList className="mx-4 mb-2 w-auto self-start">
                    <TabsTrigger value="open">
                      Open
                      {openTrades.length > 0 && (
                        <span className="ml-1.5 text-[10px] tabular-nums opacity-60">
                          {openTrades.length}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="closed">
                      Closed
                      {closedTrades.length > 0 && (
                        <span className="ml-1.5 text-[10px] tabular-nums opacity-60">
                          {closedTrades.length}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="open" className="mt-0">
                    {loading ? (
                      <div className="space-y-1 px-4 pt-1 pb-2">
                        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
                      </div>
                    ) : openTrades.length === 0 ? (
                      <Empty text="No open positions" subtext="Trades will appear here when opened." />
                    ) : (
                      <div>
                        {openTrades.map((t) => (
                          <TradeRow key={t.id} trade={t} flash={flashIds.get(t.id)} />
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="closed" className="mt-0">
                    {closedTrades.length === 0 ? (
                      <Empty text="No closed trades yet" />
                    ) : (
                      <div>
                        {closedTrades.map((t) => (
                          <TradeRow key={t.id} trade={t} />
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
