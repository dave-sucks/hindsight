import type React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StockLogo } from '@/components/StockLogo';
import { PnlBadge } from '@/components/ui/pnl-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { StockPriceChart } from '@/components/stocks/StockPriceChart';
import { StockThesesList } from '@/components/stocks/StockThesesList';
import type { ThesisRowData } from '@/components/ui/thesis-row';
import { BarGauge } from '@/components/ui/bar-gauge';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import {
  getStockProfile,
  getStockQuote,
  getStockCandles,
} from '@/lib/actions/finnhub.actions';
import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowDownUp,
  Brain,
  ExternalLink,
  Target,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { TradeActions } from '@/components/trades/TradeActions';

// ─── Helpers ────────────────────────────────────────────────────────────────

function EventIcon({ type }: { type: string }) {
  switch (type) {
    case 'PLACED':      return <ArrowDownUp className="h-3.5 w-3.5" />;
    case 'NEAR_TARGET': return <Target className="h-3.5 w-3.5 text-amber-500" />;
    case 'CLOSED':      return <CheckCircle2 className="h-3.5 w-3.5 text-positive" />;
    case 'EVALUATED':   return <Brain className="h-3.5 w-3.5 text-primary" />;
    default:            return <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
  }
}

function getStatusDisplay(
  positionStatus: string,
  outcome: string | null,
  hasPendingOrder: boolean,
  hasFilledBuy: boolean,
) {
  if (positionStatus === 'OPEN') {
    if (!hasFilledBuy && hasPendingOrder) {
      return {
        label: 'Pending fill',
        dotClass: 'bg-amber-500 animate-pulse',
        tooltip: 'Buy order submitted to Alpaca but not yet filled. The position is recorded but not actually held.',
      };
    }
    if (hasPendingOrder) {
      return {
        label: 'Closing…',
        dotClass: 'bg-amber-500 animate-pulse',
        tooltip: 'Sell order submitted but not yet filled. Still holding shares until Alpaca confirms.',
      };
    }
    return {
      label: 'Holding',
      dotClass: 'bg-positive animate-pulse',
      tooltip: 'Order filled — paper shares held in your Alpaca account.',
    };
  }
  if (positionStatus === 'CANCELLED') {
    return {
      label: 'Cancelled',
      dotClass: 'bg-muted-foreground/40',
      tooltip: 'Position cancelled before any fill.',
    };
  }
  if (outcome === 'WIN')  return { label: 'Won', dotClass: 'bg-positive', tooltip: 'Position closed at a profit.' };
  if (outcome === 'LOSS') return { label: 'Loss', dotClass: 'bg-negative', tooltip: 'Position closed at a loss.' };
  return { label: 'Closed', dotClass: 'bg-muted-foreground/40', tooltip: 'Position has been closed.' };
}

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}


function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums text-foreground truncate">{value}</span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const position = await prisma.position.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: 'asc' } },
      analyst: { select: { id: true, name: true } },
      orders: { orderBy: { createdAt: 'asc' } },
      decisions: {
        take: 1,
        include: {
          thesis: {
            include: {
              researchRun: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (!position || position.userId !== user?.id) notFound();

  const orders = position.orders;
  const hasPendingOrder = orders.some((o) => o.status === 'PENDING');
  const hasFilledBuy = orders.some((o) => o.side === 'BUY' && o.status === 'FILLED');
  const openingBuy = orders.find((o) => o.side === 'BUY');
  const closingSell = orders.filter((o) => o.side === 'SELL').slice(-1)[0];

  // Load thesis chain for this stock
  const thesisChain = await prisma.thesis.findMany({
    where: {
      userId: user.id,
      ticker: position.symbol,
      researchRun: { agentConfigId: position.analystId },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      direction: true,
      confidenceScore: true,
      reasoningSummary: true,
      signalTypes: true,
      status: true,
      parentThesisId: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      createdAt: true,
      researchRunId: true,
    },
  });

  const trade = {
    ...position,
    ticker: position.symbol,
    entryPrice: position.avgCost,
    shares: position.quantity,
    thesis: position.decisions[0]?.thesis ?? null,
    events: position.events,
  };

  // Fetch stock data + candles in parallel
  const [stockProfile, stockQuote, candles] = await Promise.all([
    getStockProfile(trade.ticker),
    getStockQuote(trade.ticker),
    getStockCandles(trade.ticker, 365),
  ]);

  const companyName = stockProfile?.name ?? null;
  const exchange = stockProfile?.exchange ?? null;

  const isOpen = position.status === 'OPEN';
  const livePrice = stockQuote?.c ?? null;
  const currentPrice = isOpen && livePrice ? livePrice : (position.closePrice ?? position.avgCost);

  // P&L
  const realizedPnl = position.realizedPnl ?? 0;
  const unrealizedDollars = isOpen
    ? position.direction === 'LONG'
      ? (currentPrice - position.avgCost) * position.quantity
      : (position.avgCost - currentPrice) * position.quantity
    : realizedPnl;
  const positionCost = position.avgCost * position.quantity;
  const pnl = isOpen ? unrealizedDollars : realizedPnl;
  const pnlPct = positionCost > 0 ? (pnl / positionCost) * 100 : 0;
  const isPos = pnl >= 0;

  const status = getStatusDisplay(position.status, position.outcome ?? null, hasPendingOrder, hasFilledBuy);
  const targetPrice = position.targetPrice ?? position.avgCost * 1.1;
  const stopPrice = position.stopLoss ?? position.avgCost * 0.9;

  // Progress to target
  const totalMove = Math.abs(
    position.direction === 'LONG' ? targetPrice - position.avgCost : position.avgCost - targetPrice
  );
  const actualMove = Math.abs(
    position.direction === 'LONG' ? currentPrice - position.avgCost : position.avgCost - currentPrice
  );
  const progressPct = totalMove > 0
    ? Math.min(100, Math.max(0, Math.round((actualMove / totalMove) * 100)))
    : 0;

  const riskMove = Math.abs(
    position.direction === 'LONG' ? position.avgCost - stopPrice : stopPrice - position.avgCost
  );
  const riskReward = riskMove > 0 ? totalMove / riskMove : 0;

  const analystName = position.analyst?.name ?? null;
  const analystIdVal = position.analyst?.id ?? null;
  const runId = trade.thesis?.researchRun?.id ?? null;

  const evalEvent = position.events.find((e) => e.eventType === 'EVALUATED');

  const fmtCur = (n: number | null | undefined) =>
    n != null
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
      : '—';

  // Chart reference lines for entry/target/stop
  const chartReferenceLines = [
    { price: trade.entryPrice, color: '#a1a1aa', label: 'Entry', dashed: true },
    { price: targetPrice, color: '#22c55e', label: 'Target', dashed: true },
    { price: stopPrice, color: '#ef4444', label: 'Stop', dashed: true },
  ];

  // Quote data for stats grid
  const changePct = stockQuote?.dp ?? null;
  const isQuoteUp = (changePct ?? 0) >= 0;

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <StockLogo ticker={trade.ticker} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold leading-tight">
                {companyName ?? trade.ticker}
              </h1>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground cursor-default">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status.dotClass}`} />
                        {status.label}
                      </span>
                    }
                  />
                  <TooltipContent side="bottom">{status.tooltip}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs font-mono uppercase text-muted-foreground tracking-wide mt-0.5">
              {trade.ticker}{exchange ? ` · ${exchange}` : ''}
            </p>
          </div>
        </div>
        <TradeActions tradeId={trade.id} ticker={trade.ticker} isOpen={isOpen} runId={runId} />
      </div>

      {/* ── 2-col grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* ════ MAIN column ════ */}
        <div className="min-w-0">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="theses">Theses</TabsTrigger>
              {!isOpen && evalEvent && (
                <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
              )}
            </TabsList>

            {/* ── OVERVIEW ─────────────────────────────────────────── */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              {/* Closed result banner */}
              {!isOpen && (
                <div className={cn(
                  'rounded-xl border px-4 py-3 text-sm font-medium flex items-center gap-2',
                  trade.outcome === 'WIN'
                    ? 'border-positive/30 bg-positive/10 text-positive'
                    : 'border-negative/30 bg-negative/10 text-negative'
                )}>
                  {trade.outcome === 'WIN'  && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  {trade.outcome === 'LOSS' && <XCircle className="h-4 w-4 shrink-0" />}
                  {(!trade.outcome || trade.outcome === 'BREAKEVEN') && <Clock className="h-4 w-4 shrink-0" />}
                  <span className="tabular-nums">
                    {status.label} · Realized P&amp;L: {isPos ? '+' : ''}${Math.abs(realizedPnl).toFixed(2)} ({isPos ? '+' : ''}{pnlPct.toFixed(2)}%)
                  </span>
                </div>
              )}

              {/* Price block */}
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold tabular-nums">
                  {fmtCur(currentPrice)}
                </span>
                {stockQuote && (
                  <span className={cn(
                    'text-xl tabular-nums flex items-center gap-2',
                    isQuoteUp ? 'text-positive' : 'text-negative',
                  )}>
                    {isQuoteUp ? '+' : ''}{fmtCur(stockQuote.d)}
                    <div className="flex items-center">
                      {isQuoteUp ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-4 w-4" />}
                      {changePct != null ? `${Math.abs(changePct).toFixed(2)}%` : '—'}
                    </div>
                  </span>
                )}
              </div>

              {/* Chart with holding summary row inside */}
              <StockPriceChart candles={candles} referenceLines={chartReferenceLines}>
                {/* Holding summary — renders inside the chart card above the graph */}
                <TooltipProvider>
                  <div className="px-4 py-2.5 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm">
                    {/* Left: status dot + summary */}
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger render={
                          isOpen ? (
                            hasPendingOrder ? (
                              <span className="relative flex h-2.5 w-2.5 shrink-0 cursor-default">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                              </span>
                            ) : (
                              <span className="relative flex h-2.5 w-2.5 shrink-0 cursor-default">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-positive opacity-75" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-positive" />
                              </span>
                            )
                          ) : (
                            <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/40 cursor-default" />
                          )
                        } />
                        <TooltipContent side="bottom">
                          <div className="tabular-nums">
                            <div>Position opened {fmtDateTime(position.openedAt)}</div>
                            {openingBuy?.filledAt && <div>Buy filled {fmtDateTime(openingBuy.filledAt)}</div>}
                            {hasPendingOrder && <div className="text-amber-500">Has pending order</div>}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      <span>
                        {isOpen
                          ? (hasFilledBuy ? 'Holding' : 'Pending')
                          : 'Sold'}{' '}
                        {trade.shares} shares at{' '}
                        <span className="tabular-nums font-medium">{fmtCur(trade.entryPrice)}</span>
                        {' '}
                        <span className="text-muted-foreground">({fmtCur(trade.entryPrice * trade.shares)} value)</span>
                      </span>
                    </div>
                    {/* Right: P&L */}
                    <div className={cn('tabular-nums flex items-center gap-1 sm:ml-auto', isPos ? 'text-positive' : 'text-negative')}>
                      {isPos ? '+' : ''}{fmtCur(pnl)}
                      {isPos ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      {Math.abs(pnlPct).toFixed(2)}%
                    </div>
                  </div>
                </TooltipProvider>
              </StockPriceChart>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2 py-3 border-y">
                <StatCell label="Entry" value={`$${trade.entryPrice.toFixed(2)}`} />
                <StatCell label="Target" value={`$${targetPrice.toFixed(2)}`} />
                <StatCell label="Stop" value={`$${stopPrice.toFixed(2)}`} />
                <StatCell label="R:R Ratio" value={`${riskReward.toFixed(2)}:1`} />
                <StatCell label="Confidence" value={`${trade.thesis?.confidenceScore ?? '—'}%`} />
                <StatCell label="Hold" value={(trade.thesis?.holdDuration as string) ?? 'Swing'} />
              </div>

              {/* Trade Thesis */}
              {trade.thesis && (() => {
                const rowData: ThesisRowData = {
                  id: trade.thesis.id,
                  ticker: trade.symbol,
                  direction: trade.thesis.direction as string,
                  confidenceScore: trade.thesis.confidenceScore,
                  reasoningSummary: trade.thesis.reasoningSummary,
                  entryPrice: trade.entryPrice,
                  targetPrice: targetPrice,
                  stopLoss: stopPrice,
                  createdAt: trade.thesis.createdAt?.toISOString?.() ?? null,
                  analystName: null,
                  runId: trade.thesis.researchRunId ?? null,
                  position: {
                    id: trade.id,
                    status: trade.status,
                    avgCost: trade.entryPrice,
                    quantity: trade.quantity,
                  },
                };
                return <StockThesesList theses={[rowData]} />;
              })()}
            </TabsContent>

            {/* ── THESES ── */}
            <TabsContent value="theses" className="mt-4 max-w-3xl">
              <StockThesesList theses={thesisChain.map((t: typeof thesisChain[number]) => ({
                id: t.id,
                ticker: trade.symbol,
                direction: t.direction,
                confidenceScore: t.confidenceScore,
                reasoningSummary: t.reasoningSummary,
                entryPrice: Number(t.entryPrice) || null,
                targetPrice: Number(t.targetPrice) || null,
                stopLoss: Number(t.stopLoss) || null,
                createdAt: t.createdAt.toISOString(),
                runId: t.researchRunId ?? null,
              }))} />
            </TabsContent>

            {/* ── EVALUATION ──────────────────────────────────────── */}
            {!isOpen && evalEvent && (
              <TabsContent value="evaluation" className="mt-4 max-w-3xl space-y-6">
                {/* Post-mortem */}
                <div className="space-y-2">
                  <h2 className="text-lg font-medium flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    Post-Mortem
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                    {evalEvent.description}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Evaluated {new Date(evalEvent.createdAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>

                {/* Event timeline */}
                <div className="space-y-3">
                  <h2 className="text-lg font-medium">Events</h2>
                  {trade.events.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No events recorded yet.</p>
                  ) : (
                    <div className="space-y-0">
                      {trade.events.map((event, i) => (
                        <div key={event.id} className="flex gap-3 pb-4 last:pb-0">
                          <div className="flex flex-col items-center">
                            <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center shrink-0 text-muted-foreground">
                              <EventIcon type={event.eventType} />
                            </div>
                            {i < trade.events.length - 1 && (
                              <div className="w-px flex-1 bg-border mt-1 min-h-[16px]" />
                            )}
                          </div>
                          <div className="pt-0.5 pb-2">
                            <p className="text-sm text-foreground leading-snug">{event.description}</p>
                            {event.priceAt != null && (
                              <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                                ${event.priceAt.toFixed(2)}
                                {event.pnlAt != null && (
                                  <span className={cn('ml-1', event.pnlAt >= 0 ? 'text-positive' : 'text-negative')}>
                                    {event.pnlAt >= 0 ? '+' : ''}${event.pnlAt.toFixed(2)}
                                  </span>
                                )}
                              </p>
                            )}
                            <p className="text-[11px] font-mono text-muted-foreground/60 mt-0.5 tabular-nums">
                              {new Date(event.createdAt).toLocaleDateString('en-US', {
                                month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* ════ SIDEBAR ════ */}
        <div className="hidden lg:block space-y-4">
          {/* Trade Details Card */}
          <Card>
            <CardContent className="p-3 flex flex-col gap-1">
              {([
                { label: 'Direction', value: trade.direction, tip: null },
                { label: 'Shares', value: String(trade.shares), tip: null },
                { label: 'Position Cost', value: `$${positionCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, tip: null },
                { label: 'Market Value', value: `$${(currentPrice * trade.shares).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, tip: null },
                ...(analystName ? [{ label: 'Analyst', value: analystName, tip: null as React.ReactNode }] : []),
                { label: 'Position opened', value: fmtDateTime(position.openedAt), tip: null },
                ...(openingBuy
                  ? [{
                      label: 'Buy order',
                      value: openingBuy.filledAt
                        ? fmtDateTime(openingBuy.filledAt)
                        : 'Pending fill',
                      pending: openingBuy.status === 'PENDING',
                      tip: (
                        <div>
                          <div>{openingBuy.filledAt ? `Filled ${fmtDateTime(openingBuy.filledAt)}` : `Ordered ${fmtDateTime(openingBuy.createdAt)}`}</div>
                          {openingBuy.status === 'PENDING' && (
                            <div className="text-amber-500">Awaiting fill · reconciles every 5 min</div>
                          )}
                          {openingBuy.alpacaOrderId && (
                            <div className="opacity-60 font-mono text-[10px]">Alpaca {openingBuy.alpacaOrderId}</div>
                          )}
                        </div>
                      ),
                    }]
                  : []),
                ...(closingSell
                  ? [{
                      label: 'Sell order',
                      value: closingSell.filledAt
                        ? fmtDateTime(closingSell.filledAt)
                        : 'Pending fill',
                      pending: closingSell.status === 'PENDING',
                      tip: (
                        <div>
                          <div>{closingSell.filledAt ? `Filled ${fmtDateTime(closingSell.filledAt)}` : `Ordered ${fmtDateTime(closingSell.createdAt)}`}</div>
                          {closingSell.status === 'PENDING' && (
                            <div className="text-amber-500">Awaiting fill · reconciles every 5 min</div>
                          )}
                          {closingSell.alpacaOrderId && (
                            <div className="opacity-60 font-mono text-[10px]">Alpaca {closingSell.alpacaOrderId}</div>
                          )}
                        </div>
                      ),
                    }]
                  : []),
              ] as Array<{ label: string; value: string; tip: React.ReactNode | null; pending?: boolean }>).map(({ label, value, tip, pending }) => (
                <div key={label} className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">{label}</span>
                  {tip ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span
                              className={cn(
                                'font-medium tabular-nums cursor-default underline decoration-dotted decoration-muted-foreground/40 underline-offset-2',
                                pending && 'text-amber-500',
                              )}
                            >
                              {value}
                            </span>
                          }
                        />
                        <TooltipContent side="left" className="text-xs max-w-xs">{tip}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <span className="font-medium tabular-nums">{value}</span>
                  )}
                </div>
              ))}

              <div className="pt-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{isOpen ? 'Unrealized P&L' : 'Realized P&L'}</span>
                  <span className={cn('font-medium tabular-nums', isPos ? 'text-positive' : 'text-negative')}>
                    {isPos ? '+' : ''}${Math.abs(pnl).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Return</span>
                  <PnlBadge value={pnlPct} />
                </div>
              </div>

              <div className="border-t pt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">R:R Ratio</span>
                  <span className="font-medium tabular-nums">{riskReward.toFixed(2)}:1</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Exit Strategy</span>
                  <span className="font-medium text-xs">{trade.exitStrategy}</span>
                </div>
                {trade.closeReason && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Close Reason</span>
                    <span className="font-medium text-xs">{trade.closeReason}</span>
                  </div>
                )}
                {trade.closedAt && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Closed</span>
                    <span className="font-medium tabular-nums text-xs">
                      {new Date(trade.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Target Progress */}
          <Card>
            <CardContent className="p-3">
              <p className="text-sm font-medium mb-2">Target Progress</p>
              <div className="space-y-2">
                <BarGauge
                  mode="fill"
                  value={progressPct / 100}
                  color={isPos ? 'positive' : 'negative'}
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                  <span>${stopPrice.toFixed(2)} stop</span>
                  <span className="font-medium text-foreground">{progressPct}%</span>
                  <span>${targetPrice.toFixed(2)} target</span>
                </div>
              </div>

              <div className="flex flex-col gap-1 border-t pt-3 mt-3">
                <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="font-medium tabular-nums">${trade.entryPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-positive">Target</span>
                  <span className="font-medium tabular-nums text-positive">
                    ${targetPrice.toFixed(2)}
                    <span className="text-muted-foreground ml-1">
                      +{(((targetPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-negative">Stop</span>
                  <span className="font-medium tabular-nums text-negative">
                    ${stopPrice.toFixed(2)}
                    <span className="text-muted-foreground ml-1">
                      −{(((trade.entryPrice - stopPrice) / trade.entryPrice) * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stock Info */}
          {stockProfile && (
            <Card>
              <CardContent className="p-3 flex flex-col gap-1">
                <p className="text-sm font-medium mb-0.5">Stock Info</p>
                {[
                  { label: 'Symbol', value: trade.ticker },
                  { label: 'Exchange', value: stockProfile.exchange || '—' },
                  { label: 'Industry', value: stockProfile.finnhubIndustry || '—' },
                  { label: 'Country', value: stockProfile.country || '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm border-b border-border pb-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-right max-w-[60%] truncate">{value}</span>
                  </div>
                ))}
                {stockProfile.weburl && (
                  <a
                    href={stockProfile.weburl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    {stockProfile.weburl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
