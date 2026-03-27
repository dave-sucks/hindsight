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
import { SegmentBar } from '@/components/ui/segment-bar';
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
  TrendingUp,
  TrendingDown,
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

function getStatusDisplay(status: string, outcome: string | null) {
  if (status === 'OPEN') return { label: 'Held', dotClass: 'bg-blue-400 animate-pulse', tooltip: 'This position is actively held.' };
  if (outcome === 'WIN')  return { label: 'Won', dotClass: 'bg-positive', tooltip: 'Position closed with a profit.' };
  if (outcome === 'LOSS') return { label: 'Loss', dotClass: 'bg-negative', tooltip: 'Position closed at a loss.' };
  return { label: 'Closed', dotClass: 'bg-muted-foreground/40', tooltip: 'Position has been closed.' };
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

  const status = getStatusDisplay(position.status, position.outcome ?? null);
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
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular-nums">
                    {fmtCur(currentPrice)}
                  </span>
                  {stockQuote && (
                    <span className={cn(
                      'text-sm font-medium tabular-nums flex items-center gap-0.5',
                      isQuoteUp ? 'text-positive' : 'text-negative',
                    )}>
                      {isQuoteUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {fmtCur(stockQuote.d)} ({changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <span className="tabular-nums">Entry {fmtCur(trade.entryPrice)}</span>
                  <span>→</span>
                  <span className={cn('tabular-nums font-medium', isPos ? 'text-positive' : 'text-negative')}>
                    {isPos ? '+' : ''}{fmtCur(pnl)} ({isPos ? '+' : ''}{pnlPct.toFixed(2)}%)
                  </span>
                  <span className="text-muted-foreground/60">·</span>
                  <span>{trade.shares} shares</span>
                </div>
              </div>

              {/* Chart with reference lines */}
              <StockPriceChart candles={candles} referenceLines={chartReferenceLines} />

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2 py-3 border-y">
                <StatCell label="Entry" value={`$${trade.entryPrice.toFixed(2)}`} />
                <StatCell label="Target" value={`$${targetPrice.toFixed(2)}`} />
                <StatCell label="Stop" value={`$${stopPrice.toFixed(2)}`} />
                <StatCell label="R:R Ratio" value={`${riskReward.toFixed(2)}:1`} />
                <StatCell label="Confidence" value={`${trade.thesis?.confidenceScore ?? '—'}%`} />
                <StatCell label="Hold" value={(trade.thesis?.holdDuration as string) ?? 'Swing'} />
              </div>

              {/* Thesis reasoning (if available) */}
              {trade.thesis && (
                <div className="space-y-2">
                  <h2 className="text-lg font-medium">Thesis</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {trade.thesis.reasoningSummary}
                  </p>
                  {(trade.thesis.signalTypes as string[] ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(trade.thesis.signalTypes as string[]).map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px]">
                          {s.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── THESES — Perplexity "Notable Price Movement" style ── */}
            <TabsContent value="theses" className="mt-4 max-w-3xl">
              {thesisChain.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No thesis history for this position.
                </div>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    {thesisChain.map((t, i) => {
                      const isCurrent = t.id === trade.thesis?.id;
                      const isActive = t.status === 'ACTIVE';
                      const dirColor = t.direction === 'LONG'
                        ? 'text-emerald-500'
                        : t.direction === 'SHORT'
                        ? 'text-red-500'
                        : 'text-muted-foreground';

                      return (
                        <div
                          key={t.id}
                          className={cn(
                            'flex gap-4 px-5 py-4',
                            i < thesisChain.length - 1 && 'border-b border-border',
                          )}
                        >
                          {/* Date + dot column */}
                          <div className="w-16 shrink-0 pt-1 text-right">
                            <p className="text-xs text-muted-foreground font-medium">
                              {new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </p>
                            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                              {new Date(t.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </p>
                          </div>

                          {/* Dot */}
                          <div className="flex flex-col items-center pt-2">
                            <div className={cn(
                              'h-2.5 w-2.5 rounded-full shrink-0',
                              isCurrent ? 'bg-primary' : isActive ? 'bg-blue-400' : 'bg-muted-foreground/30',
                            )} />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            {/* First line: price + direction + confidence */}
                            <div className="flex items-center gap-2">
                              {t.entryPrice != null && (
                                <span className="text-sm font-medium tabular-nums">
                                  ${Number(t.entryPrice).toFixed(2)}
                                </span>
                              )}
                              <span className={cn('text-sm font-medium', dirColor)}>
                                {t.direction === 'LONG' ? '↗' : t.direction === 'SHORT' ? '↘' : '—'} {t.confidenceScore}%
                              </span>
                              {t.status === 'SUPERSEDED' && (
                                <span className="text-xs text-amber-500">Superseded</span>
                              )}
                              {t.status === 'INVALIDATED' && (
                                <span className="text-xs text-red-500">Invalidated</span>
                              )}
                              {isActive && (
                                <span className="text-xs text-blue-400 font-medium">Active</span>
                              )}
                              {isCurrent && (
                                <span className="text-xs text-primary font-medium">Trade Thesis</span>
                              )}
                            </div>

                            {/* Reasoning paragraph */}
                            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                              {t.reasoningSummary}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
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
              {[
                { label: 'Direction', value: trade.direction },
                { label: 'Shares', value: String(trade.shares) },
                { label: 'Position Cost', value: `$${positionCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}` },
                { label: 'Market Value', value: `$${(currentPrice * trade.shares).toLocaleString('en-US', { maximumFractionDigits: 0 })}` },
                ...(analystName ? [{ label: 'Analyst', value: analystName }] : []),
                { label: 'Submitted', value: new Date(trade.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
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
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-medium">Target Progress</h3>
              <div className="space-y-2">
                <SegmentBar
                  filled={progressPct / 10}
                  fillColor={isPos ? 'bg-positive' : 'bg-negative'}
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                  <span>${stopPrice.toFixed(2)} stop</span>
                  <span className="font-medium text-foreground">{progressPct}%</span>
                  <span>${targetPrice.toFixed(2)} target</span>
                </div>
              </div>

              <div className="space-y-1.5 border-t pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="tabular-nums">${trade.entryPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-positive">Target</span>
                  <span className="tabular-nums text-positive">
                    ${targetPrice.toFixed(2)}
                    <span className="text-muted-foreground ml-1">
                      +{(((targetPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-negative">Stop</span>
                  <span className="tabular-nums text-negative">
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
              <CardContent className="px-4 pt-4 pb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Stock Info</p>
                <div className="space-y-0">
                  {[
                    { label: 'Symbol', value: trade.ticker },
                    { label: 'Exchange', value: stockProfile.exchange || '—' },
                    { label: 'Industry', value: stockProfile.finnhubIndustry || '—' },
                    { label: 'Country', value: stockProfile.country || '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between py-1.5 border-b last:border-0">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-medium text-foreground text-right max-w-[60%] truncate">{value}</span>
                    </div>
                  ))}
                </div>
                {stockProfile.weburl && (
                  <a
                    href={stockProfile.weburl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
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
