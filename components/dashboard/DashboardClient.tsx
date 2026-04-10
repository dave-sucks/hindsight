'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';

import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThesisRow } from '@/components/ui/thesis-row';
import type { ThesisRowData } from '@/components/ui/thesis-row';
import { TradeRow as SharedTradeRow } from '@/components/ui/trade-row';
import { OnboardingChecklist } from '@/components/domain/onboarding-checklist';
import { EmptyStateBg } from '@/components/domain/empty-state-bg';
import { ProductTourDialog } from '@/components/domain/onboarding-flow';
import { Button } from '@/components/ui/button';
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

// ─── Constants ────────────────────────────────────────────────────────────────

const RANGES = ['1D', '1W', '1M', '1Y', 'Max'] as const;
type Range = (typeof RANGES)[number];

const RANGE_DAYS: Record<Range, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '1Y': 365,
  Max: 99999,
};

type ChartView = 'portfolio' | 'by-analyst' | 'vs-spy';
type DisplayMode = 'dollar' | 'percent';

const ANALYST_COLORS = [
  '#6366f1',
  '#f59e0b',
  '#10b981',
  '#f43f5e',
  '#8b5cf6',
  '#06b6d4',
];

const TICK_STYLE = { fontSize: 9, fill: '#71717a', fontFamily: 'var(--font-mono)' };

const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '12px',
  color: 'var(--popover-foreground)',
};

// ─── Data helpers ─────────────────────────────────────────────────────────────

function cutoffMs(range: Range) {
  return Date.now() - RANGE_DAYS[range] * 86_400_000;
}

function filterByRange<T extends { date: string }>(data: T[], range: Range): T[] {
  const ms = cutoffMs(range);
  const filtered = data.filter((d) => new Date(d.date + 'T12:00:00').getTime() >= ms);
  return filtered.length > 1 ? filtered : data.slice(-2);
}

/**
 * Build wide-format multi-analyst chart data with index keys (a0, a1, ...).
 * Normalizes each curve as % of $100K starting capital to avoid division-by-zero.
 */
function buildAnalystCompareData(
  analysts: { id: string; name: string }[],
  curves: Record<string, { date: string; value: number }[]>,
  range: Range,
): Record<string, number | string>[] {
  if (analysts.length === 0) return [];

  const maps = new Map<string, Map<string, number>>();
  for (let i = 0; i < analysts.length; i++) {
    const raw = filterByRange(curves[analysts[i].id] ?? [], range);
    if (raw.length === 0) continue;
    const m = new Map<string, number>();
    for (const pt of raw) {
      m.set(pt.date, (pt.value / 100_000) * 100);
    }
    maps.set(`a${i}`, m);
  }
  if (maps.size === 0) return [];

  const allDates = new Set<string>();
  for (const m of maps.values()) for (const d of m.keys()) allDates.add(d);
  const sortedDates = [...allDates].sort();

  return sortedDates.map((date) => {
    const row: Record<string, number | string> = { date };
    for (const [key, m] of maps.entries()) {
      const v = m.get(date);
      if (v !== undefined) row[key] = v;
    }
    return row;
  });
}

/**
 * Build two-line % comparison: portfolio vs SPY.
 */
function buildSpyCompareData(
  equityCurve: { date: string; value: number }[],
  spyCandles: { date: string; close: number }[],
  range: Range,
): { date: string; portfolio: number; spy: number }[] {
  const portSlice = filterByRange(equityCurve, range);
  const spySlice = filterByRange(spyCandles.map((c) => ({ date: c.date, value: c.close })), range);
  if (portSlice.length < 2 || spySlice.length < 2) return [];

  const portBase = portSlice[0].value;
  const spyBase = spySlice[0].value;
  if (portBase === 0 || spyBase === 0) return [];

  const spyMap = new Map(spySlice.map((d) => [d.date, d.value]));

  return portSlice
    .filter((d) => spyMap.has(d.date))
    .map((d) => ({
      date: d.date,
      portfolio: ((d.value - portBase) / portBase) * 100,
      spy: ((spyMap.get(d.date)! - spyBase) / spyBase) * 100,
    }));
}

// ─── Recent picks section ─────────────────────────────────────────────────────

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

function RecentPicksSection({ picks }: { picks: RecentPick[] }) {
  const [filter, setFilter] = useState<PickFilter>('all');
  const [showTour, setShowTour] = useState(false);

  const filtered = picks.filter((p) => {
    if (filter === 'open') return p.position?.status === 'OPEN';
    if (filter === 'passed') return p.direction === 'PASS' || (!p.position && p.decision !== 'BUY');
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        {(['all', 'open', 'passed'] as PickFilter[]).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors border capitalize',
              filter === key
                ? 'bg-secondary text-secondary-foreground border-secondary'
                : 'text-muted-foreground opacity-60 hover:opacity-100 hover:text-foreground',
            )}
          >
            {key}
          </button>
        ))}
      </div>

      {picks.length === 0 ? (
        <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl py-24 px-4">
          <div
            className="absolute inset-0"
            style={{
              maskImage:
                'linear-gradient(to right, transparent, black 15%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
              maskComposite: 'intersect',
              WebkitMaskImage:
                'linear-gradient(to right, transparent, black 15%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
              WebkitMaskComposite: 'source-in',
            }}
          >
            <EmptyStateBg />
          </div>
          <div className="relative z-10 flex flex-col items-center gap-3">
            <p className="text-base font-medium text-center">
              Theses for your Stocks appear after Agents run
            </p>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              Your analyst will research stocks, generate theses, and place paper trades autonomously.
            </p>
            <div className="flex items-center gap-2">
              <Link
                href="/analysts"
                className="inline-flex items-center justify-center h-8 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-muted"
              >
                Create an Analyst
              </Link>
              <Button variant="ghost" size="sm" onClick={() => setShowTour(true)}>
                Product Overview
              </Button>
            </div>
            <ProductTourDialog open={showTour} onOpenChange={setShowTour} />
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border px-4 py-8 flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground text-center">No picks match this filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((pick) => (
            <ThesisRow key={pick.id} thesis={pickToThesisRow(pick)} showTicker={true} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Positions trade row ──────────────────────────────────────────────────────

function DashboardTradeRow({ trade, flash }: { trade: MockTrade; flash?: 'win' | 'loss' }) {
  return (
    <SharedTradeRow
      id={trade.id}
      ticker={trade.ticker}
      currentPrice={trade.currentPrice}
      entryPrice={trade.entryPrice}
      shares={trade.shares}
      pnl={trade.pnl ?? 0}
      pnlPct={trade.pnlPct ?? 0}
      status={trade.status}
      placedAt={trade.placedAt}
      filledAt={trade.filledAt}
      closedAt={trade.closedAt}
      priceSource={trade.priceSource}
      priceUpdatedAt={trade.priceUpdatedAt}
      alpacaOrderId={trade.alpacaOrderId}
      flash={flash}
    />
  );
}

function Empty({ text, subtext }: { text: string; subtext?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-1.5 px-4">
      <p className="text-sm text-muted-foreground text-center">{text}</p>
      {subtext && (
        <p className="text-xs text-muted-foreground/60 text-center">{subtext}</p>
      )}
    </div>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return (
    <div className="h-52 flex items-center justify-center">
      <p className="text-xs text-muted-foreground text-center max-w-xs px-4">{text}</p>
    </div>
  );
}

// ─── DashboardClient ──────────────────────────────────────────────────────────

interface DashboardClientProps {
  data?: DashboardData;
  userId?: string;
}

export default function DashboardClient({ data, userId }: DashboardClientProps) {
  const [range, setRange] = useState<Range>('1M');
  const [chartView, setChartView] = useState<ChartView>('portfolio');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('dollar');
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
            position.realizedPnl != null
              ? `P&L: $${position.realizedPnl.toFixed(2)}`
              : undefined,
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

  // ── Raw data ────────────────────────────────────────────────────────────────
  const openTrades = (data?.openTrades ?? mockOpenTrades).filter(
    (t) => !realtimeClosedIds.has(t.id),
  );
  const closedTrades = data?.closedTrades ?? [];
  const analysts = data?.analysts ?? [];
  const analystEquityCurves = data?.analystEquityCurves ?? {};
  const spyBenchmark = data?.spyBenchmark ?? { '1W': null, '1M': null, '1Y': null };
  const spyCandles = data?.spyCandles ?? [];
  const recentPicks = data?.recentPicks ?? [];

  const rawEquity = data && data.equityCurve.length > 0 ? data.equityCurve : mockEquityCurve;

  const portfolio = data?.portfolio ?? {
    totalValue: mockPortfolio.totalValue,
    unrealizedPnl: mockPortfolio.dayChange,
    realizedPnl: mockPortfolio.totalPnl,
    winRate: 0.6,
    openCount: mockOpenTrades.length,
  };

  // ── Portfolio header values ─────────────────────────────────────────────────
  const totalValueStr = formatCurrency(portfolio.totalValue);
  const totalPnl = portfolio.unrealizedPnl + portfolio.realizedPnl;
  const pnlPositive = totalPnl >= 0;
  const startingCapital = portfolio.totalValue - totalPnl;
  const totalPnlPct = startingCapital > 0 ? (totalPnl / startingCapital) * 100 : 0;
  const winRateStr =
    portfolio.winRate != null
      ? `${(portfolio.winRate * 100).toFixed(0)}% win rate`
      : null;

  const spyPct: number | null =
    range === '1W' ? spyBenchmark['1W']
    : range === '1M' ? spyBenchmark['1M']
    : range === '1Y' ? spyBenchmark['1Y']
    : null;

  // ── Chart data (memoized) ───────────────────────────────────────────────────
  const portfolioData = useMemo(
    () => filterByRange(rawEquity, range),
    [rawEquity, range],
  );

  // % return from first data point in the selected range
  const portfolioPercentData = useMemo(() => {
    if (portfolioData.length < 2) return portfolioData;
    const base = portfolioData[0].value;
    if (base === 0) return portfolioData.map((d) => ({ ...d, value: 0 }));
    return portfolioData.map((d) => ({
      date: d.date,
      value: ((d.value - base) / base) * 100,
    }));
  }, [portfolioData]);

  const activePortfolioData = displayMode === 'percent' ? portfolioPercentData : portfolioData;

  const analystCompareData = useMemo(
    () => buildAnalystCompareData(analysts, analystEquityCurves, range),
    [analysts, analystEquityCurves, range],
  );

  const spyCompareData = useMemo(
    () => buildSpyCompareData(rawEquity, spyCandles, range),
    [rawEquity, spyCandles, range],
  );

  // ── Chart visuals ───────────────────────────────────────────────────────────
  const equityPositive =
    portfolioData.length > 1
      ? portfolioData[portfolioData.length - 1].value >= portfolioData[0].value
      : true;
  const strokeColor = equityPositive ? PNL_HEX.positive : PNL_HEX.negative;

  const analystChartConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    analysts.forEach((analyst, i) => {
      cfg[`a${i}`] = {
        label: analyst.name,
        color: ANALYST_COLORS[i % ANALYST_COLORS.length],
      };
    });
    return cfg;
  }, [analysts]);

  const spyChartConfig = useMemo<ChartConfig>(
    () => ({
      portfolio: { label: 'Portfolio', color: strokeColor },
      spy: { label: 'S&P 500', color: '#71717a' },
    }),
    [strokeColor],
  );

  const loading = !data;

  const hasPortfolioData = activePortfolioData.length >= 2;
  const hasAnalystData = analystCompareData.length >= 2 && analysts.length >= 1;
  const hasSpyData = spyCompareData.length >= 2;

  const effectiveView: ChartView =
    chartView === 'by-analyst' && analysts.length === 0 ? 'portfolio'
    : chartView === 'vs-spy' && spyCandles.length === 0 ? 'portfolio'
    : chartView;

  return (
    <div className="overflow-y-auto h-[calc(100dvh-3rem)]">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex gap-6 items-start">

          {/* ══ LEFT column ══════════════════════════════════════════════════ */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Portfolio header */}
            <div className="space-y-1">
              {loading ? (
                <>
                  <Skeleton className="h-10 w-48" />
                  <Skeleton className="h-5 w-64" />
                </>
              ) : (
                <>
                  <p className="text-4xl font-semibold tabular-nums tracking-tight">
                    {totalValueStr}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-sm tabular-nums flex items-center gap-1">
                      <span className={pnlPositive ? 'text-positive' : 'text-negative'}>
                        {pnlPositive ? '+' : '-'}${Math.abs(totalPnl).toFixed(2)}{' '}
                        ({pnlPositive ? '+' : ''}{totalPnlPct.toFixed(2)}%)
                      </span>
                      {winRateStr && (
                        <>
                          <span className="text-muted-foreground mx-0.5">—</span>
                          <span className="text-muted-foreground">{winRateStr}</span>
                        </>
                      )}
                    </p>
                    {spyPct !== null && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        vs SPY{' '}
                        <span className={spyPct >= 0 ? 'text-positive' : 'text-negative'}>
                          {spyPct >= 0 ? '+' : ''}{spyPct.toFixed(2)}%
                        </span>
                        {' '}{range}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Chart card */}
            <div
              className="rounded-lg overflow-hidden border"
              style={{
                backgroundImage:
                  'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
                backgroundSize: '18px 18px',
                backgroundColor: 'hsl(var(--muted)/0.3)',
              }}
            >
              {/* Controls: range tabs (left) + settings dropdown (right) */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 gap-2">
                {/* Range tabs */}
                <div className="flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border px-1 py-0.5">
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

                {/* Settings dropdown */}
                {!loading && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" />}>
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>View</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={effectiveView}
                          onValueChange={(v) => setChartView(v as ChartView)}
                        >
                          <DropdownMenuRadioItem value="portfolio">Portfolio</DropdownMenuRadioItem>
                          {analysts.length > 0 && (
                            <DropdownMenuRadioItem value="by-analyst">By Analyst</DropdownMenuRadioItem>
                          )}
                          {spyCandles.length > 0 && (
                            <DropdownMenuRadioItem value="vs-spy">vs S&amp;P 500</DropdownMenuRadioItem>
                          )}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                      {effectiveView === 'portfolio' && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Display</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={displayMode}
                              onValueChange={(v) => setDisplayMode(v as DisplayMode)}
                            >
                              <DropdownMenuRadioItem value="dollar">$ Value</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="percent">% Return</DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                          </DropdownMenuGroup>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Chart render */}
              {loading ? (
                <div className="h-[260px] flex items-center justify-center">
                  <Skeleton className="h-1 w-3/4 rounded-full" />
                </div>
              ) : effectiveView === 'portfolio' ? (
                !hasPortfolioData ? (
                  <ChartEmpty text="The equity chart tracks portfolio value over time as trades open and close." />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart
                      data={activePortfolioData}
                      margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={strokeColor} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatDateLabel(v).toUpperCase()}
                        interval={Math.max(1, Math.floor(activePortfolioData.length / 6))}
                        padding={{ left: 0, right: 0 }}
                      />
                      <YAxis hide domain={['dataMin * 0.999', 'dataMax * 1.001']} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v) => [
                          displayMode === 'dollar'
                            ? `$${Number(v).toLocaleString()}`
                            : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`,
                          'Portfolio',
                        ]}
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
                        baseValue="dataMin"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )
              ) : effectiveView === 'by-analyst' ? (
                !hasAnalystData ? (
                  <ChartEmpty text="Not enough trade history to compare analysts yet." />
                ) : (
                  <ChartContainer config={analystChartConfig} className="h-[260px] w-full">
                    <LineChart
                      data={analystCompareData}
                      margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                    >
                      <XAxis
                        dataKey="date"
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatDateLabel(String(v)).toUpperCase()}
                        interval={Math.max(1, Math.floor(analystCompareData.length / 6))}
                        padding={{ left: 8, right: 8 }}
                      />
                      <YAxis
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`}
                        width={48}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v, key) => {
                          const idx = parseInt(String(key).replace('a', ''), 10);
                          const name = analysts[idx]?.name ?? String(key);
                          const pct = Number(v);
                          return [`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`, name];
                        }}
                        labelFormatter={(l: unknown) => formatDateLabel(String(l))}
                        labelStyle={{ color: 'var(--muted-foreground)' }}
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      {analysts.map((_, i) => (
                        <Line
                          key={`a${i}`}
                          type="monotone"
                          dataKey={`a${i}`}
                          stroke={`var(--color-a${i})`}
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ChartContainer>
                )
              ) : (
                !hasSpyData ? (
                  <ChartEmpty text="Not enough data to compare against S&P 500 for this range." />
                ) : (
                  <ChartContainer config={spyChartConfig} className="h-[260px] w-full">
                    <LineChart
                      data={spyCompareData}
                      margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                    >
                      <XAxis
                        dataKey="date"
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatDateLabel(String(v)).toUpperCase()}
                        interval={Math.max(1, Math.floor(spyCompareData.length / 6))}
                        padding={{ left: 8, right: 8 }}
                      />
                      <YAxis
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`}
                        width={48}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v, name) => [
                          `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`,
                          name === 'portfolio' ? 'Portfolio' : 'S&P 500',
                        ]}
                        labelFormatter={(l: unknown) => formatDateLabel(String(l))}
                        labelStyle={{ color: 'var(--muted-foreground)' }}
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Line
                        type="monotone"
                        dataKey="portfolio"
                        stroke="var(--color-portfolio)"
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="spy"
                        stroke="var(--color-spy)"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                    </LineChart>
                  </ChartContainer>
                )
              )}
            </div>

            {/* Recent picks — all picks, no analyst filter, only All/Open/Passed pills */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-48 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <RecentPicksSection picks={recentPicks} />
            )}
          </div>

          {/* ══ RIGHT column — positions ═══════════════════════════════════ */}
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
                        {[1, 2, 3].map((i) => (
                          <Skeleton key={i} className="h-14 rounded-lg" />
                        ))}
                      </div>
                    ) : openTrades.length === 0 ? (
                      <Empty
                        text="No open positions"
                        subtext="Positions appear when an analyst places a paper trade during a run."
                      />
                    ) : (
                      <div>
                        {openTrades.map((t) => (
                          <DashboardTradeRow
                            key={t.id}
                            trade={t}
                            flash={flashIds.get(t.id)}
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="closed" className="mt-0">
                    {closedTrades.length === 0 ? (
                      <Empty
                        text="No closed trades yet"
                        subtext="Trades close when they hit a target, stop-loss, or manual exit."
                      />
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

      {!loading && (
        <OnboardingChecklist
          hasAlpacaKey={data?.hasAlpacaKey ?? false}
          hasAnalyst={(data?.analystCount ?? 0) > 0}
          hasCompletedRun={data?.hasCompletedRun ?? false}
          hasBrief={data?.hasBrief ?? false}
        />
      )}
    </div>
  );
}
