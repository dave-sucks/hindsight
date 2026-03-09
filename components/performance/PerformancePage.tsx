'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AnalyticsData } from '@/lib/actions/analytics.actions';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
} from 'recharts';
import { TrendingUp, Trophy, Target, BarChart3 } from 'lucide-react';

// ─── Recharts dark theme constants ────────────────────────────────────────────
const GRID_COLOR = 'var(--border)';
const AXIS_COLOR = 'var(--muted-foreground)';
const EMERALD = '#10b981';      // emerald-500
const RED = '#ef4444';          // red-500
const BLUE = '#3b82f6';         // blue-500 (primary)

const TIME_RANGES = ['1D', '1W', '1M', 'ALL'] as const;
type TimeRange = (typeof TIME_RANGES)[number];

// ─── Tooltip styles ───────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; fill?: string }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 text-sm shadow-lg">
      {label && <p className="text-xs text-muted-foreground mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: p.fill ?? BLUE }}>
          {p.name ? `${p.name}: ` : ''}{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </p>
      ))}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <Card className="border-border">
      <CardContent className="p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
        <p className={cn(
          'text-2xl font-semibold tabular-nums',
          positive === undefined ? 'text-foreground' : positive ? 'text-emerald-500' : 'text-red-500'
        )}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Section skeleton ─────────────────────────────────────────────────────────

function ChartSkeleton({ height = 200 }: { height?: number }) {
  return <Skeleton style={{ height }} className="w-full" />;
}

// ─── Empty chart placeholder ──────────────────────────────────────────────────

function EmptyChart({ height = 220, message = 'No data yet' }: { height?: number; message?: string }) {
  return (
    <div
      style={{ height }}
      className="w-full flex items-center justify-center rounded-md bg-secondary/20 border border-dashed border-border"
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface Props {
  data: AnalyticsData;
}

export default function PerformancePage({ data }: Props) {
  const [activeRange, setActiveRange] = useState<TimeRange>('1M');

  const { equityCurve, directionBreakdown, durationBreakdown, sectorBreakdown, confidenceScatter, stats } = data;
  const { totalReturn, totalReturnPct, winRate, avgReturnPerTrade, openTrades, closedTrades, totalTrades, graduation } = stats;

  const winRatePct = Math.min((graduation.currentWinRate / graduation.winRateTarget) * 100, 100);
  const tradesPct = Math.min((graduation.currentClosedTrades / graduation.closedTradesRequired) * 100, 100);
  const graduationPct = Math.round((winRatePct + tradesPct) / 2);

  const noTrades = closedTrades === 0;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">Performance</h1>

      {/* ── Top stats bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          label="Total Return"
          value={`${totalReturn >= 0 ? '+' : ''}$${Math.abs(totalReturn).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          positive={totalReturn > 0}
        />
        <StatCard
          label="Total Return %"
          value={`${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}%`}
          positive={totalReturnPct > 0}
        />
        <StatCard
          label="Win Rate"
          value={noTrades ? '—' : `${winRate.toFixed(1)}%`}
          positive={winRate >= 50}
          sub={`vs ${graduation.winRateTarget.toFixed(0)}% target`}
        />
        <StatCard
          label="Avg Return/Trade"
          value={noTrades ? '—' : `${avgReturnPerTrade.toFixed(1)}%`}
          positive={avgReturnPerTrade > 0}
        />
        <StatCard label="Open Trades" value={String(openTrades)} />
        <StatCard label="Total Trades" value={String(totalTrades)} sub={`${closedTrades} closed`} />
      </div>

      {/* ── Charts row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equity curve */}
        <Card className="border-border">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-medium">Equity Curve</CardTitle>
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
            {equityCurve.length < 2 ? (
              <EmptyChart height={220} message="Place trades to see your equity curve" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={equityCurve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: AXIS_COLOR }}
                    axisLine={false}
                    tickLine={false}
                    interval={4}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: AXIS_COLOR }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    width={46}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={EMERALD}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: EMERALD }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Win/Loss by Direction */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium">Win/Loss by Direction</CardTitle>
          </CardHeader>
          <CardContent>
            {directionBreakdown.every((d) => d.wins === 0 && d.losses === 0) ? (
              <EmptyChart height={220} message="Close trades to see direction breakdown" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={directionBreakdown} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="direction"
                    tick={{ fontSize: 11, fill: AXIS_COLOR }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: AXIS_COLOR }}
                    axisLine={false}
                    tickLine={false}
                    width={24}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="wins" name="Wins" fill={EMERALD} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="losses" name="Losses" fill={RED} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Avg Return by Hold Duration */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium">Avg Return by Duration</CardTitle>
          </CardHeader>
          <CardContent>
            {durationBreakdown.length === 0 ? (
              <EmptyChart height={220} message="Close trades to see duration breakdown" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={durationBreakdown} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="duration"
                    tick={{ fontSize: 11, fill: AXIS_COLOR }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: AXIS_COLOR }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                    width={36}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="avgReturn" name="Avg Return %" radius={[3, 3, 0, 0]}>
                    {durationBreakdown.map((entry, i) => (
                      <Cell key={i} fill={entry.avgReturn >= 0 ? EMERALD : RED} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Confidence Score vs Outcome Scatter */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium">Confidence vs Outcome</CardTitle>
          </CardHeader>
          <CardContent>
            {confidenceScatter.length === 0 ? (
              <EmptyChart height={220} message="Close trades to see confidence vs outcome" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ScatterChart margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="confidence"
                    name="Confidence"
                    domain={[50, 95]}
                    tick={{ fontSize: 10, fill: AXIS_COLOR }}
                    axisLine={false}
                    tickLine={false}
                    label={{
                      value: 'Confidence %',
                      position: 'insideBottomRight',
                      offset: -5,
                      fontSize: 10,
                      fill: AXIS_COLOR,
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="return"
                    name="Return %"
                    tick={{ fontSize: 10, fill: AXIS_COLOR }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                    width={40}
                  />
                  <ReferenceLine y={0} stroke={GRID_COLOR} strokeWidth={1.5} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3', stroke: GRID_COLOR }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload as { ticker: string; confidence: number; return: number };
                      return (
                        <div className="bg-card border border-border rounded-md px-3 py-2 text-sm shadow-lg">
                          <p className="font-mono font-semibold text-foreground">{d.ticker}</p>
                          <p className="text-xs text-muted-foreground">Conf: <span className="tabular-nums text-foreground">{d.confidence}%</span></p>
                          <p className={cn('text-xs tabular-nums', d.return >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                            Return: {d.return >= 0 ? '+' : ''}{d.return.toFixed(2)}%
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={confidenceScatter} name="Trades">
                    {confidenceScatter.map((entry, i) => (
                      <Cell key={i} fill={entry.return >= 0 ? EMERALD : RED} fillOpacity={0.8} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Sector breakdown (full width) ── */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Return by Sector</CardTitle>
        </CardHeader>
        <CardContent>
          {sectorBreakdown.length === 0 ? (
            <EmptyChart height={180} message="No sector data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sectorBreakdown} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="sector"
                  tick={{ fontSize: 11, fill: AXIS_COLOR }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: AXIS_COLOR }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                  width={36}
                />
                <ReferenceLine y={0} stroke={GRID_COLOR} strokeWidth={1.5} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="return" name="Avg Return %" radius={[3, 3, 0, 0]}>
                  {sectorBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.return >= 0 ? BLUE : RED} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Graduation Tracker ── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-lg font-medium">Graduation Tracker</CardTitle>
            <Badge variant="outline" className="ml-auto border-amber-500/40 text-amber-500 text-xs">
              Paper Trading
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Hit your targets to graduate to real trading with real money.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Overall progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">Overall Progress</span>
              <span className="tabular-nums text-muted-foreground">{graduationPct}%</span>
            </div>
            <Progress value={graduationPct} className="h-3" />
          </div>

          {/* Sub-metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: BarChart3,
                label: 'Win Rate',
                current: graduation.currentWinRate.toFixed(1),
                target: graduation.winRateTarget.toFixed(0),
                unit: '%',
                pct: winRatePct,
                positive: graduation.currentWinRate >= graduation.winRateTarget,
              },
              {
                icon: Target,
                label: 'Closed Trades',
                current: String(graduation.currentClosedTrades),
                target: String(graduation.closedTradesRequired),
                unit: '',
                pct: tradesPct,
                positive: graduation.currentClosedTrades >= graduation.closedTradesRequired,
              },
              {
                icon: TrendingUp,
                label: 'Est. Remaining',
                current: String(Math.max(0, graduation.closedTradesRequired - graduation.currentClosedTrades)),
                target: null,
                unit: ' more trades',
                pct: null,
                positive: undefined as boolean | undefined,
              },
            ].map(({ icon: Icon, label, current, target, unit, pct, positive }) => (
              <div key={label} className="bg-secondary/30 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </span>
                </div>
                <p className={cn(
                  'text-xl font-semibold tabular-nums',
                  positive === undefined ? 'text-foreground' : positive ? 'text-emerald-500' : 'text-amber-500'
                )}>
                  {current}{unit}
                  {target !== null && (
                    <span className="text-sm text-muted-foreground font-normal"> / {target}{unit}</span>
                  )}
                </p>
                {pct !== null && (
                  <Progress value={pct} className="h-1.5" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
