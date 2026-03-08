'use client';

import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import TradingViewWidget from '@/components/TradingViewWidget';
import { MARKET_OVERVIEW_WIDGET_CONFIG } from '@/lib/constants';
import {
    mockOpenTrades,
    mockClosedTrades,
    mockPortfolio,
    mockEquityCurve,
    mockWatchlist,
    MockTrade,
} from '@/lib/mock-data/trades';

const TIME_RANGES = ['1D', '1W', '1M', '3M', 'YTD', 'ALL'] as const;

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

function TradeRow({ trade, closed = false }: { trade: MockTrade; closed?: boolean }) {
    const pnl = trade.pnl ?? 0;
    const positive = pnl >= 0;
    return (
        <div className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
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

export default function DashboardClient() {
    const [range, setRange] = useState<string>('1M');

    const dayPositive = mockPortfolio.dayChange >= 0;
    const totalValue = mockPortfolio.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <div className="flex h-[calc(100vh-3rem)] md:h-screen overflow-hidden">
            {/* ── Main content ────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                <div className="px-6 pt-8 pb-6 max-w-3xl space-y-6">

                    {/* Portfolio header — Robinhood style */}
                    <div className="space-y-0.5">
                        <p className="text-sm text-muted-foreground">Portfolio Value</p>
                        <p className="text-4xl font-semibold tabular-nums tracking-tight">
                            ${totalValue}
                        </p>
                        <p className={`text-sm tabular-nums ${dayPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                            {dayPositive ? '+' : ''}${Math.abs(mockPortfolio.dayChange).toFixed(2)}&nbsp;
                            ({dayPositive ? '+' : ''}{mockPortfolio.dayChangePct.toFixed(2)}%) today
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
                            <AreaChart data={mockEquityCurve} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
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
                                    Active Positions ({mockOpenTrades.length})
                                </p>
                                <div>
                                    {mockOpenTrades.map(t => (
                                        <TradeRow key={t.id} trade={t} />
                                    ))}
                                </div>
                            </div>

                            <Separator />

                            {/* Closed trades */}
                            <div>
                                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                                    Recent Closed ({mockClosedTrades.length})
                                </p>
                                <div>
                                    {mockClosedTrades.slice(0, 6).map(t => (
                                        <TradeRow key={t.id} trade={t} closed />
                                    ))}
                                </div>
                            </div>
                        </TabsContent>

                        {/* ── Market tab — original TradingView overview from Signalist ── */}
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

            {/* ── Right rail: stats + watchlist ─────────────────── */}
            <div className="hidden lg:flex w-60 border-l flex-col shrink-0">
                <ScrollArea className="flex-1">
                    <div className="p-4 space-y-5">
                        {/* Quick stats */}
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                                Quick Stats
                            </p>
                            <div className="space-y-2.5">
                                {([
                                    { label: 'Open Positions', value: String(mockPortfolio.totalValue > 0 ? mockOpenTrades.length : 0) },
                                    { label: 'Win Rate', value: '60%' },
                                    { label: 'Avg Confidence', value: '74%' },
                                    { label: 'Total P&L', value: `+$${mockPortfolio.totalPnl.toFixed(0)}`, positive: true },
                                ]).map(({ label, value, positive }) => (
                                    <div key={label} className="flex justify-between items-center">
                                        <span className="text-xs text-muted-foreground">{label}</span>
                                        <span className={`text-xs font-medium tabular-nums ${positive ? 'text-emerald-500' : ''}`}>
                                            {value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Separator />

                        {/* Watchlist */}
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                                Watchlist
                            </p>
                            <div>
                                {mockWatchlist.map(item => {
                                    const pos = item.changePct >= 0;
                                    return (
                                        <div
                                            key={item.ticker}
                                            className="flex items-center justify-between py-2 px-1 -mx-1 rounded-md hover:bg-accent/50 transition-colors cursor-pointer"
                                        >
                                            <div>
                                                <p className="text-sm font-medium">{item.ticker}</p>
                                                <p className="text-xs text-muted-foreground">{item.name}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm tabular-nums font-medium">
                                                    ${item.price.toFixed(2)}
                                                </p>
                                                <p className={`text-xs tabular-nums ${pos ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    {pos ? '+' : ''}{item.changePct.toFixed(2)}%
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}
