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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ThesisRow } from '@/components/ui/thesis-row';
import type { ThesisRowData } from '@/components/ui/thesis-row';
import { TradeRow as SharedTradeRow } from '@/components/ui/trade-row';
import { Bot } from 'lucide-react';
import {
  mockOpenTrades,
  mockEquityCurve,
  mockPortfolio,
  type MockTrade,
} from '@/lib/mock-data/trades';
import type { DashboardData, RecentPick } from '@/lib/actions/portfolio.actions';
import { useTradeRealtime, type RealtimeTrade } from '@/hooks/useTradeRealtime';
import { toast } from 'sonner';
import { cn, PNL_HEX } from '@/lib/utils';
import { formatCurrency, formatDateLabel } from '@/lib/format';

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
  if (range === '1D' && data.length > 0) {
    // Synthesize intraday points across trading hours (9:30 AM – 4 PM ET)
    const last = data[data.length - 1];
    const prev = data.length > 1 ? data[data.length - 2] : last;
    const hours = ['9:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00'];
    const today = last.date;
    const diff = last.value - prev.value;
    return hours.map((h, i) => ({
      date: `${today}T${h}`,
      value: prev.value + (diff * (i / (hours.length - 1))),
    }));
  }
  const cutoffMs = Date.now() - RANGE_DAYS[range] * 86_400_000;
  if (data.length > 0 && data[0].date.length === 10 && data[0].date.includes('-')) {
    const filtered = data.filter((d) => new Date(d.date + 'T12:00:00').getTime() >= cutoffMs);
    return filtered.length > 1 ? filtered : data.slice(-2);
  }
  return data;
}

// ─── Recent pick → ThesisCardData mapper ─────────────────────────────────────

type PickFilter = 'all' | 'open' | 'passed';

function pickToThesisRow(pick: RecentPick): ThesisRowData {
  return {
    id: pick.id,
    ticker: pick.ticker,
    direction: pick.direction,
    confidenceScore: pick.confidenceScore,
    reasoningSummary: pick.reasoningSummary,
    entryPrice: pick.entryPrice,
    targetPrice: pick.targetPrice,
    stopLoss: pick.stopLoss,
    createdAt: pick.position?.openedAt ?? pick.createdAt,
    currentPrice: pick.currentPrice,
    companyName: pick.companyName,
    analystName: pick.analystName,
    analystId: pick.analystId,
    runId: pick.runId,
    sourcesUsed: pick.sourcesUsed,
    decision: pick.decision,
    position: pick.position
      ? {
          id: pick.position.id,
          status: pick.position.status,
          avgCost: pick.position.avgCost,
          quantity: pick.position.quantity,
        }
      : null,
  };
}

// ─── Recent picks section ─────────────────────────────────────────────────────

function RecentPicksSection({ picks }: { picks: RecentPick[] }) {
  const [filter, setFilter] = useState<PickFilter>('all');

  const filtered = picks.filter((p) => {
    if (filter === 'open') return p.position?.status === 'OPEN';
    if (filter === 'passed') return p.direction === 'PASS' || (!p.position && p.decision !== 'BUY');
    return true;
  });

  const pills: { key: PickFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'passed', label: 'Passed' },
  ];

  return (
    <div className="space-y-3">
      {/* Filter tabs — no section header, tabs ARE the header */}
      <div className="flex items-center gap-1.5">
        {pills.map((pill) => (
          <button
            key={pill.key}
            onClick={() => setFilter(pill.key)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
              filter === pill.key
                ? 'bg-secondary text-secondary-foreground border-secondary'
                : 'text-muted-foreground opacity-60 hover:opacity-100 hover:text-foreground',
            )}
          >
            {pill.label}
          </button>
        ))}
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
            <ThesisRow
              key={pick.id}
              thesis={pickToThesisRow(pick)}
              showTicker={true}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Trade row (for positions card) ──────────────────────────────────────────

function DashboardTradeRow({
  trade,
  flash,
}: {
  trade: MockTrade;
  flash?: 'win' | 'loss';
}) {
  return (
    <SharedTradeRow
      id={trade.id}
      ticker={trade.ticker}
      currentPrice={trade.currentPrice}
      shares={trade.shares}
      pnl={trade.pnl ?? 0}
      pnlPct={trade.pnlPct ?? 0}
      status={trade.status}
      flash={flash}
    />
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
  userId?: string;
}

export default function DashboardClient({
  data,
  userId,
}: DashboardClientProps) {
  const [range, setRange] = useState<Range>('1M');
  const [realtimeClosedIds, setRealtimeClosedIds] = useState<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Map<string, 'win' | 'loss'>>(new Map());

  const handlePositionUpdate = useCallback((position: RealtimeTrade) => {
    if (position.status === 'CLOSED' || position.status.startsWith('CLOSED_')) {
      const result = position.outcome === 'WIN' ? 'win' : 'loss';
      setFlashIds((prev) => new Map(prev).set(position.id, result));
      toast[result === 'win' ? 'success' : 'error'](
        `${position.symbol} closed — ${result === 'win' ? '✅ WIN' : '❌ LOSS'}`,
        {
          description:
            position.realizedPnl != null ? `P&L: $${position.realizedPnl.toFixed(2)}` : undefined,
        },
      );
      setTimeout(() => {
        setFlashIds((prev) => {
          const m = new Map(prev);
          m.delete(position.id);
          return m;
        });
        setRealtimeClosedIds((prev) => new Set(prev).add(position.id));
      }, 1200);
    }
  }, []);

  useTradeRealtime({ userId: userId ?? '', onPositionUpdate: handlePositionUpdate });

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

  const totalValueStr = formatCurrency(portfolio.totalValue);
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
  const strokeColor = equityPositive ? PNL_HEX.positive : PNL_HEX.negative;

  const loading = !data;

  return (
    // ── Scrollable page wrapper — NOT full-height flex sidebar ──────────────
    <div className="overflow-y-auto h-[calc(100dvh-3rem)]">
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
                    {totalValueStr}
                  </p>
                  <p className="text-sm tabular-nums flex items-center gap-1 flex-wrap">
                    <span className={pnlPositive ? 'text-positive' : 'text-negative'}>
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
                        ? 'bg-muted text-foreground font-medium'
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
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={equityData} margin={{ top: 40, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={strokeColor} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: '#71717a', fontFamily: 'var(--font-mono)' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatDateLabel(v).toUpperCase()}
                      interval={Math.max(1, Math.floor(equityData.length / 6))}
                      padding={{ left: 0, right: 0 }}
                    />
                    <YAxis hide domain={['dataMin - 500', 'dataMax + 500']} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--popover)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'var(--popover-foreground)',
                      }}
                      formatter={(v) => [`$${Number(v).toLocaleString()}`, 'Portfolio']}
                      labelFormatter={(l: unknown) => formatDateLabel(String(l))}
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


          </div>

          {/* ══ RIGHT column — normal Card (NOT a sidebar) ══════════════════ */}
          <div className="hidden lg:block w-80 shrink-0">
            <Tabs defaultValue="open" className="gap-0">
              <TabsList variant="line" className="w-auto self-start px-0">
                <TabsTrigger value="open" className="px-0 mr-4">
                  Open
                  {openTrades.length > 0 && (
                    <span className="ml-1.5 text-[10px] tabular-nums opacity-60">
                      {openTrades.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="closed" className="px-0">
                  Closed
                  {closedTrades.length > 0 && (
                    <span className="ml-1.5 text-[10px] tabular-nums opacity-60">
                      {closedTrades.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              <Card className="shadow-none p-0">
                <CardContent className="p-0">
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
                          <DashboardTradeRow key={t.id} trade={t} flash={flashIds.get(t.id)} />
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
                          <DashboardTradeRow key={t.id} trade={t} />
                        ))}
                      </div>
                    )}
                  </TabsContent>

                </CardContent>
              </Card>
            </Tabs>
          </div>

        </div>
      </div>
    </div>
  );
}

