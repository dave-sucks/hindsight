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
import { Bot, TrendingUp } from 'lucide-react';
import {
    mockOpenTrades,
    mockEquityCurve,
    mockPortfolio,
    type MockTrade,
} from '@/lib/mock-data/trades';
import type {
    DashboardData,
    AgentConfigSummary,
    RecentRunSummary,
    TodaysPick,
} from '@/lib/actions/portfolio.actions';
import { useTradeRealtime, type RealtimeTrade } from '@/hooks/useTradeRealtime';
import { toast } from 'sonner';

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

// ─── TodaysPicks (DAV-85) ─────────────────────────────────────────────────────

function PickCard({ pick }: { pick: TodaysPick }) {
    const isLong = pick.direction === 'LONG';
    const score = pick.confidenceScore;
    const scoreColor =
        score >= 80
            ? 'text-emerald-500'
            : score >= 65
            ? 'text-foreground'
            : 'text-red-500';

    return (
        <div className="shrink-0 w-40 rounded-lg border bg-card p-4 space-y-2 hover:bg-accent/50 transition-colors">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{pick.ticker}</span>
                <Badge
                    variant={isLong ? 'default' : 'outline'}
                    className="text-[10px] h-4 px-1"
                >
                    {pick.direction}
                </Badge>
            </div>
            <div>
                <p className={`text-2xl font-bold tabular-nums ${scoreColor}`}>
                    {score}%
                </p>
                <p className="text-xs text-muted-foreground">confidence</p>
            </div>
            {pick.signalTypes.length > 0 && (
                <Badge
                    variant="secondary"
                    className="text-[10px] h-4 px-1.5 max-w-full truncate block"
                >
                    {pick.signalTypes[0].replace(/_/g, ' ')}
                </Badge>
            )}
        </div>
    );
}

function TodaysPicksSection({ picks }: { picks: TodaysPick[] }) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg font-medium">Today's Picks</CardTitle>
            </CardHeader>
            <CardContent>
                {picks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <TrendingUp className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground text-center">
                            No picks today yet — run an analyst to generate ideas.
                        </p>
                    </div>
                ) : (
                    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                        {picks.map((pick) => (
                            <PickCard key={pick.id} pick={pick} />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── OpenTradesCard ───────────────────────────────────────────────────────────

function OpenTradeRow({
    trade,
    flash,
}: {
    trade: MockTrade;
    flash?: 'win' | 'loss';
}) {
    const pnl = trade.pnl ?? 0;
    const positive = pnl >= 0;
    const openedAt = new Date(trade.openedAt);
    const daysHeld = Math.max(
        0,
        Math.floor((Date.now() - openedAt.getTime()) / (1000 * 60 * 60 * 24))
    );

    return (
        <div
            className={`flex items-center justify-between py-3 border-b border-border/50 last:border-0 transition-all ${
                flash === 'win'
                    ? 'bg-emerald-500/10'
                    : flash === 'loss'
                    ? 'bg-red-500/10'
                    : ''
            }`}
        >
            <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground">
                        {trade.ticker.slice(0, 2)}
                    </span>
                </div>
                <div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{trade.ticker}</span>
                        <Badge
                            variant={trade.direction === 'LONG' ? 'default' : 'outline'}
                            className="text-[10px] h-4 px-1 py-0"
                        >
                            {trade.direction}
                        </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                        ${trade.entryPrice.toFixed(2)} · {daysHeld}d held
                    </p>
                </div>
            </div>
            <div className="text-right">
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
                    {positive ? '+' : ''}{trade.pnlPct?.toFixed(2) ?? '0.00'}%
                </p>
            </div>
        </div>
    );
}

function OpenTradesCard({
    trades,
    flashIds,
}: {
    trades: MockTrade[];
    flashIds: Map<string, 'win' | 'loss'>;
}) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-medium">Open Trades</CardTitle>
                    <Badge variant="outline">{trades.length}</Badge>
                </div>
            </CardHeader>
            <CardContent>
                {trades.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <TrendingUp className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                            No open trades
                        </p>
                        <p className="text-xs text-muted-foreground/60 text-center">
                            Run an analyst to generate theses and place trades.
                        </p>
                    </div>
                ) : (
                    <div>
                        {trades.map((trade) => (
                            <OpenTradeRow
                                key={trade.id}
                                trade={trade}
                                flash={flashIds.get(trade.id)}
                            />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── AgentStatusCard ──────────────────────────────────────────────────────────

function AgentConfigRow({ agent }: { agent: AgentConfigSummary }) {
    return (
        <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
            <div className="flex items-center gap-3">
                <div
                    className={`h-2 w-2 rounded-full shrink-0 mt-0.5 ${
                        agent.enabled
                            ? 'bg-emerald-500'
                            : 'bg-muted-foreground/40'
                    }`}
                />
                <div>
                    <p className="text-sm font-medium">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">
                        {agent.lastRunAt
                            ? `Last run ${formatRelativeTime(new Date(agent.lastRunAt))}`
                            : 'Never run'}{' '}
                        · {agent.tradesPlaced} trade
                        {agent.tradesPlaced !== 1 ? 's' : ''}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 tabular-nums">
                    {agent.scheduleTime}
                </Badge>
                <Badge
                    variant={agent.enabled ? 'default' : 'secondary'}
                    className="text-[10px] h-5 px-1.5"
                >
                    {agent.enabled ? 'Active' : 'Off'}
                </Badge>
            </div>
        </div>
    );
}

function AgentStatusCard({ agentConfigs }: { agentConfigs: AgentConfigSummary[] }) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg font-medium">Agent Status</CardTitle>
            </CardHeader>
            <CardContent>
                {agentConfigs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <Bot className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                            No agents configured
                        </p>
                        <p className="text-xs text-muted-foreground/60 text-center">
                            Create an analyst in Settings to automate research.
                        </p>
                    </div>
                ) : (
                    <div>
                        {agentConfigs.map((agent) => (
                            <AgentConfigRow key={agent.id} agent={agent} />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── RecentActivityCard ───────────────────────────────────────────────────────

function RecentRunRow({ run }: { run: RecentRunSummary }) {
    const statusColor =
        run.status === 'COMPLETE'
            ? 'text-emerald-500'
            : run.status === 'FAILED'
            ? 'text-red-500'
            : run.status === 'RUNNING'
            ? 'text-blue-500'
            : 'text-muted-foreground';

    return (
        <Link href="/research">
            <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0 hover:bg-accent/50 -mx-2 px-2 rounded-lg transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Bot className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                        <p className="text-sm font-medium">
                            {run.agentName ?? 'Manual Research'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {run.thesisCount} thesis
                            {run.thesisCount !== 1 ? 'es' : ''} · {run.tradesPlaced}{' '}
                            trade{run.tradesPlaced !== 1 ? 's' : ''} placed
                        </p>
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <p
                        className={`text-xs font-medium uppercase tracking-wide ${statusColor}`}
                    >
                        {run.status.toLowerCase()}
                    </p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                        {formatRelativeTime(new Date(run.startedAt))}
                    </p>
                </div>
            </div>
        </Link>
    );
}

function RecentActivityCard({ runs }: { runs: RecentRunSummary[] }) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg font-medium">
                    Recent Agent Activity
                </CardTitle>
            </CardHeader>
            <CardContent>
                {runs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <Bot className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground text-center">
                            No recent activity — run an analyst to generate research.
                        </p>
                    </div>
                ) : (
                    <div>
                        {runs.map((run) => (
                            <RecentRunRow key={run.id} run={run} />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── DashboardClient ──────────────────────────────────────────────────────────

interface DashboardClientProps {
    data?: DashboardData;
    userId?: string;
}

export default function DashboardClient({ data, userId }: DashboardClientProps) {
    const [realtimeClosedIds, setRealtimeClosedIds] = useState<Set<string>>(
        new Set()
    );
    const [flashIds, setFlashIds] = useState<Map<string, 'win' | 'loss'>>(
        new Map()
    );

    const handleTradeUpdate = useCallback(
        (trade: RealtimeTrade) => {
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
        },
        []
    );

    useTradeRealtime({ userId: userId ?? '', onTradeUpdate: handleTradeUpdate });

    // Data with mock fallbacks
    const openTrades = (data?.openTrades ?? mockOpenTrades).filter(
        (t) => !realtimeClosedIds.has(t.id)
    );
    const equityData =
        data && data.equityCurve.length > 0 ? data.equityCurve : mockEquityCurve;
    const portfolio = data?.portfolio ?? {
        totalValue: mockPortfolio.totalValue,
        unrealizedPnl: mockPortfolio.dayChange,
        realizedPnl: mockPortfolio.totalPnl,
        winRate: 0.6,
        openCount: mockOpenTrades.length,
    };
    const agentConfigs = data?.agentConfigs ?? [];
    const recentRuns = data?.recentRuns ?? [];
    const todaysPicks = data?.todaysPicks ?? [];

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
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Page title */}
            <h1 className="text-2xl font-semibold">Dashboard</h1>

            {/* ── Top: Stat chips + equity curve ──────────────────────────────── */}
            <Card>
                <CardContent className="pt-6">
                    {/* Stat chips */}
                    <div className="flex flex-wrap gap-6 mb-6">
                        <StatChip
                            label="Portfolio Value"
                            value={`$${totalValueStr}`}
                        />
                        <StatChip
                            label="Today's P&L"
                            value={`${dayPositive ? '+' : ''}$${Math.abs(unrealizedPnl).toFixed(2)} (${dayPositive ? '+' : ''}${unrealizedPct.toFixed(2)}%)`}
                            positive={dayPositive}
                        />
                        <StatChip label="Win Rate" value={winRateStr} />
                        <StatChip
                            label="Open Positions"
                            value={String(portfolio.openCount)}
                        />
                    </div>

                    {/* Equity curve */}
                    <ResponsiveContainer width="100%" height={200}>
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
                                tick={{
                                    fontSize: 11,
                                    fill: 'var(--muted-foreground)',
                                }}
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

            {/* ── Today's Picks (DAV-85) ───────────────────────────────────────── */}
            <TodaysPicksSection picks={todaysPicks} />

            {/* ── Middle 2-col: Open Trades + Agent Status ─────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <OpenTradesCard trades={openTrades} flashIds={flashIds} />
                <AgentStatusCard agentConfigs={agentConfigs} />
            </div>

            {/* ── Bottom: Recent Agent Activity ────────────────────────────────── */}
            <RecentActivityCard runs={recentRuns} />
        </div>
    );
}
