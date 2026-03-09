'use client';

import { useState, useEffect, useCallback } from 'react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import TradingViewWidget from '@/components/TradingViewWidget';
import { MARKET_OVERVIEW_WIDGET_CONFIG } from '@/lib/constants';
import {
    mockOpenTrades,
    mockClosedTrades,
    mockPortfolio,
    mockEquityCurve,
    MockTrade,
} from '@/lib/mock-data/trades';
import type { DashboardData } from '@/lib/actions/portfolio.actions';
import { useTradeRealtime, type RealtimeTrade } from '@/hooks/useTradeRealtime';
import { AgentActivityLog } from '@/components/dashboard/AgentActivityLog';
import { toast } from 'sonner';

const TIME_RANGES = ['1D', '1W', '1M', '3M', 'YTD', 'ALL'] as const;
type TimeRange = typeof TIME_RANGES[number];

const COMPANY_NAMES: Record<string, string> = {
    NVDA: 'NVIDIA Corp',
    TSLA: 'Tesla Inc',
    AAPL: 'Apple Inc',
    META: 'Meta Platforms',
    COIN: 'Coinbase',
    MSFT: 'Microsoft Corp',
    GOOGL: 'Alphabet',
    SNAP: 'Snap Inc',
    NFLX: 'Netflix',
};

function TradeRow({
    trade,
    closed = false,
    flash,
}: {
    trade: MockTrade;
    closed?: boolean;
    flash?: 'win' | 'loss';
}) {
    const pnl = trade.pnl ?? 0;
    const positive = pnl >= 0;
    return (
        <div className={`flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-accent/50 transition-all cursor-pointer ${
            flash === 'win' ? 'bg-emerald-500/15 scale-[1.01]' :
            flash === 'loss' ? 'bg-red-500/15 scale-[1.01]' : ''
        }`}>
            <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground">
                        {trade.ticker.slice(0, 2)}
                    </span>
                </div>
                <div>
                    <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-medium ${closed ? 'text-muted-foreground' : ''}`}>
                            {trade.ticker}
                        </span>
                        {!closed && (
                            <Badge
                                variant={trade.direction === 'LONG' ? 'default' : 'outline'}
                                className="text-[10px] h-4 px-1 py-0"
                            >
                                {trade.direction}
                            </Badge>
                        )}
                        {closed && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 py-0">
                                {trade.status.replace('CLOSED_', '')}
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {COMPANY_NAMES[trade.ticker] ?? trade.ticker}
                    </p>
                </div>
            </div>
            <div className="text-right">
                <p className={`text-sm font-medium tabular-nums ${positive ? 'text-emerald-500' : 'text-red-500'}`}>
                    {positive ? '+' : ''}${Math.abs(pnl).toFixed(2)}
                </p>
                <p className={`text-xs tabular-nums ${positive ? 'text-emerald-500' : 'text-red-500'}`}>
                    {positive ? '+' : ''}{trade.pnlPct?.toFixed(2) ?? '0.00'}%
                </p>
            </div>
        </div>
    );
}

interface DashboardClientProps {
    /** Real data from the server. Falls back to mock data when omitted. */
    data?: DashboardData;
    userId?: string;
}

export default function DashboardClient({ data, userId }: DashboardClientProps) {
    const [range, setRange] = useState<TimeRange>('1M');
    // Track which trade IDs have been closed in real time so we can flash them
    const [realtimeClosedIds, setRealtimeClosedIds] = useState<Set<string>>(new Set());
    const [flashIds, setFlashIds] = useState<Map<string, 'win' | 'loss'>>(new Map());

    // ── Supabase Realtime: trade updates ──────────────────────────────────
    const handleTradeUpdate = useCallback((trade: RealtimeTrade) => {
        if (trade.status === 'CLOSED' || trade.status.startsWith('CLOSED_')) {
            const result = trade.outcome === 'WIN' ? 'win' : 'loss';
            // Flash the row before removing it
            setFlashIds(prev => new Map(prev).set(trade.id, result));
            toast[result === 'win' ? 'success' : 'error'](
                `${trade.ticker} closed — ${result === 'win' ? '✅ WIN' : '❌ LOSS'}`,
                { description: trade.realizedPnl != null ? `P&L: $${trade.realizedPnl.toFixed(2)}` : undefined }
            );
            // After flash animation, move to closed
            setTimeout(() => {
                setFlashIds(prev => { const m = new Map(prev); m.delete(trade.id); return m; });
                setRealtimeClosedIds(prev => new Set(prev).add(trade.id));
            }, 1200);
        }
    }, []);

    useTradeRealtime({ userId: userId ?? '', onTradeUpdate: handleTradeUpdate });

    // Use real data when provided, otherwise fall back to mock
    // Filter out trades closed in real time (they'll appear in closed list after refresh)
    const openTrades = (data?.openTrades ?? mockOpenTrades).filter(
        t => !realtimeClosedIds.has(t.id)
    );
    const closedTrades = data?.closedTrades ?? mockClosedTrades;
    const equityData = data && data.equityCurve.length > 0 ? data.equityCurve : mockEquityCurve;

    const totalValue = data?.portfolio.totalValue ?? mockPortfolio.totalValue;
    const unrealizedPnl = data?.portfolio.unrealizedPnl ?? mockPortfolio.dayChange;
    const dayPositive = unrealizedPnl >= 0;
    const totalValueStr = totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const unrealizedPct = totalValue > 0 ? (unrealizedPnl / (totalValue - unrealizedPnl)) * 100 : 0;

    const winRateStr = data?.portfolio.winRate != null
        ? `${(data.portfolio.winRate * 100).toFixed(0)}%`
        : '60%';
    const avgConfidence = openTrades.length > 0
        ? `${Math.round(openTrades.reduce((s, t) => s + t.confidenceScore, 0) / openTrades.length)}%`
        : '74%';
    const totalPnlStr = data?.portfolio.realizedPnl != null
        ? `${data.portfolio.realizedPnl >= 0 ? '+' : ''}$${Math.abs(data.portfolio.realizedPnl).toFixed(0)}`
        : `+$${mockPortfolio.totalPnl.toFixed(0)}`;
    const totalPnlPositive = data?.portfolio.realizedPnl != null ? data.portfolio.realizedPnl >= 0 : true;

    return (
        <div className="flex h-[calc(100vh-3rem)] md:h-screen overflow-hidden">
            {/* ── Main content ────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                <div className="px-6 pt-8 pb-6 max-w-3xl space-y-6">

                    {/* Portfolio header — Robinhood style */}
                    <div className="space-y-0.5">
                        <p className="text-sm text-muted-foreground">Portfolio Value</p>
                        <p className="text-4xl font-semibold tabular-nums tracking-tight">
                            ${totalValueStr}
                        </p>
                        <p className={`text-sm tabular-nums ${dayPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                            {dayPositive ? '+' : ''}${Math.abs(unrealizedPnl).toFixed(2)}&nbsp;
                            ({dayPositive ? '+' : ''}{unrealizedPct.toFixed(2)}%) today
                        </p>
                    </div>

                    {/* Time range selector */}
                    <div className="flex items-center gap-0.5">
                        {TIME_RANGES.map(r => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                                    range === r
                                        ? 'bg-foreground text-background'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                                }`}
                            >
                                {r}
                            </button>
                        ))}
                    </div>

                    {/* Equity curve */}
                    <div className="-mx-1">
                        <ResponsiveContainer width="100%" height={160}>
                            <AreaChart data={equityData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.12} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="date" hide />
                                <YAxis hide domain={['auto', 'auto']} />
                                <Tooltip
                                    contentStyle={{
                                        background: 'var(--popover)',
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        color: 'var(--popover-foreground)',
                                    }}
                                    formatter={(v) => [`$${Number(v).toLocaleString()}`, 'Value']}
                                    labelStyle={{ color: 'var(--muted-foreground)' }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke="#10b981"
                                    strokeWidth={1.5}
                                    fill="url(#equityGrad)"
                                    dot={false}
                                    activeDot={{ r: 3, fill: '#10b981' }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Portfolio / Market tabs */}
                    <Tabs defaultValue="portfolio">
                        <TabsList>
                            <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
                            <TabsTrigger value="market">Market</TabsTrigger>
                        </TabsList>

                        {/* ── Portfolio tab ── */}
                        <TabsContent value="portfolio" className="mt-4 space-y-4">
                            {/* Active positions */}
                            <div>
                                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                                    Active Positions ({openTrades.length})
                                </p>
                                <div>
                                    {openTrades.map(t => (
                                        <TradeRow key={t.id} trade={t} flash={flashIds.get(t.id)} />
                                    ))}
                                </div>
                            </div>

                            <Separator />

                            {/* Closed trades */}
                            <div>
                                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                                    Recent Closed ({closedTrades.length})
                                </p>
                                <div>
                                    {closedTrades.slice(0, 6).map(t => (
                                        <TradeRow key={t.id} trade={t} closed />
                                    ))}
                                </div>
                            </div>
                        </TabsContent>

                        {/* ── Market tab — TradingView market overview ── */}
                        <TabsContent value="market" className="mt-4">
                            <TradingViewWidget
                                scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js"
                                config={MARKET_OVERVIEW_WIDGET_CONFIG}
                                height={560}
                            />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>

            {/* ── Right rail: stats + agent activity log ─────────── */}
            <div className="hidden lg:flex w-72 border-l flex-col shrink-0 overflow-hidden">
                {/* Quick stats — fixed height at top */}
                <div className="p-4 space-y-3 border-b shrink-0">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Quick Stats
                    </p>
                    <div className="space-y-2">
                        {[
                            { label: 'Open Positions', value: String(data?.portfolio.openCount ?? openTrades.length) },
                            { label: 'Win Rate', value: winRateStr },
                            { label: 'Avg Confidence', value: avgConfidence },
                            { label: 'Total P&L', value: totalPnlStr, positive: totalPnlPositive },
                        ].map(({ label, value, positive }) => (
                            <div key={label} className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">{label}</span>
                                <span className={`text-xs font-medium tabular-nums ${positive ? 'text-emerald-500' : ''}`}>
                                    {value}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Agent activity log — fills remaining height */}
                <div className="flex-1 min-h-0 p-3">
                    <AgentActivityLog userId={userId ?? ''} />
                </div>
            </div>
        </div>
    );
}
