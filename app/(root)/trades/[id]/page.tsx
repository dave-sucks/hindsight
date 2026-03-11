import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StockLogo } from '@/components/StockLogo';
import { Badge } from '@/components/ui/badge';
import { PnlBadge } from '@/components/ui/pnl-badge';
import TradingViewWidget from '@/components/TradingViewWidget';
import { CANDLE_CHART_WIDGET_CONFIG } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowDownUp,
  AlertCircle,
  Brain,
  ExternalLink,
  Target,
} from 'lucide-react';

// ─── Event icon map ─────────────────────────────────────────────────────────

function EventIcon({ type }: { type: string }) {
  const major = ['PLACED', 'CLOSED', 'NEAR_TARGET', 'EVALUATED'];
  const isMajor = major.includes(type);
  switch (type) {
    case 'PLACED':      return <ArrowDownUp className="h-3.5 w-3.5" />;
    case 'NEAR_TARGET': return <Target className="h-3.5 w-3.5 text-amber-500" />;
    case 'CLOSED':      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'EVALUATED':   return <Brain className="h-3.5 w-3.5 text-primary" />;
    default:            return <span className={cn('h-2 w-2 rounded-full', isMajor ? 'bg-foreground' : 'bg-muted-foreground/40')} />;
  }
}

// ─── Status helpers ──────────────────────────────────────────────────────────

function getStatusDisplay(status: string, outcome: string | null) {
  if (status === 'OPEN') return { label: 'Open', dotClass: 'bg-blue-400 animate-pulse' };
  if (outcome === 'WIN')  return { label: 'Won', dotClass: 'bg-emerald-500' };
  if (outcome === 'LOSS') return { label: 'Loss', dotClass: 'bg-red-500' };
  return { label: 'Closed', dotClass: 'bg-muted-foreground/40' };
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

  const trade = await prisma.trade.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: 'asc' } },
      thesis: {
        include: {
          researchRun: {
            select: {
              id: true,
              agentConfig: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!trade || trade.userId !== user?.id) notFound();

  const isOpen = trade.status === 'OPEN';
  const currentPrice = trade.closePrice ?? trade.entryPrice;

  // P&L
  const realizedPnl = trade.realizedPnl ?? 0;
  const unrealizedDollars = isOpen
    ? trade.direction === 'LONG'
      ? (currentPrice - trade.entryPrice) * trade.shares
      : (trade.entryPrice - currentPrice) * trade.shares
    : realizedPnl;
  const positionCost = trade.entryPrice * trade.shares;
  const pnl = isOpen ? unrealizedDollars : realizedPnl;
  const pnlPct = positionCost > 0 ? (pnl / positionCost) * 100 : 0;
  const isPos = pnl >= 0;

  const status = getStatusDisplay(trade.status, trade.outcome ?? null);
  const targetPrice = trade.targetPrice ?? trade.entryPrice * 1.1;
  const stopPrice = trade.stopLoss ?? trade.entryPrice * 0.9;

  // Progress to target
  const totalMove = Math.abs(
    trade.direction === 'LONG' ? targetPrice - trade.entryPrice : trade.entryPrice - targetPrice
  );
  const actualMove = Math.abs(
    trade.direction === 'LONG' ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice
  );
  const progressPct = totalMove > 0
    ? Math.min(100, Math.max(0, Math.round((actualMove / totalMove) * 100)))
    : 0;

  const riskMove = Math.abs(
    trade.direction === 'LONG' ? trade.entryPrice - stopPrice : stopPrice - trade.entryPrice
  );
  const riskReward = riskMove > 0 ? totalMove / riskMove : 0;

  // Analyst + run info
  const analystName = trade.thesis?.researchRun?.agentConfig?.name ?? null;
  const analystId = trade.thesis?.researchRun?.agentConfig?.id ?? null;
  const runId = trade.thesis?.researchRun?.id ?? null;

  // Post-mortem eval event
  const evalEvent = trade.events.find((e) => e.eventType === 'EVALUATED');

  const thesisBullets = (trade.thesis?.thesisBullets ?? []) as string[];
  const riskFlags = (trade.thesis?.riskFlags ?? []) as string[];

  const chartConfig = {
    ...CANDLE_CHART_WIDGET_CONFIG,
    symbol: `NASDAQ:${trade.ticker}`,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Back nav */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground -ml-2 mb-4"
        render={<Link href="/trades" />}
      >
        <ArrowLeft className="h-4 w-4" />
        Paper Trades
      </Button>

      {/* ── 2-column layout ── */}
      <div className="flex gap-6">
        {/* ════ LEFT column ════ */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Header: StockLogo + ticker + status */}
          <div className="flex items-center gap-3">
            <StockLogo ticker={trade.ticker} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-brand text-2xl leading-tight">{trade.ticker}</h1>
                <span className="text-xs font-mono text-muted-foreground">
                  {trade.direction}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status.dotClass}`} />
                  {status.label}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                {analystName && analystId && (
                  <Link href={`/analysts/${analystId}`} className="hover:text-foreground transition-colors">
                    {analystName}
                  </Link>
                )}
                {analystName && <span className="opacity-30">·</span>}
                <span>
                  {new Date(trade.openedAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </span>
                {runId && (
                  <>
                    <span className="opacity-30">·</span>
                    <Link href={`/runs/${runId}`} className="hover:text-foreground transition-colors inline-flex items-center gap-0.5">
                      View run <ExternalLink className="h-3 w-3" />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Closed result banner */}
          {!isOpen && (
            <div className={cn(
              'rounded-xl border px-4 py-3 text-sm font-medium flex items-center gap-2',
              trade.outcome === 'WIN'
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-500'
                : 'border-red-500/30 bg-red-500/5 text-red-500'
            )}>
              {trade.outcome === 'WIN'  && <CheckCircle2 className="h-4 w-4 shrink-0" />}
              {trade.outcome === 'LOSS' && <XCircle className="h-4 w-4 shrink-0" />}
              {(!trade.outcome || trade.outcome === 'BREAKEVEN') && <Clock className="h-4 w-4 shrink-0" />}
              <span className="tabular-nums">
                {status.label} · Realized P&amp;L: {isPos ? '+' : ''}${Math.abs(realizedPnl).toFixed(2)} ({isPos ? '+' : ''}{pnlPct.toFixed(2)}%)
              </span>
            </div>
          )}

          {/* Chart wrapper: bg-muted/30 rounded-xl border */}
          <div className="bg-muted/30 rounded-xl border overflow-hidden">
            {/* 2-col header: stock price | your position */}
            <div className="flex items-stretch divide-x">
              {/* Left: current price */}
              <div className="flex-1 p-4">
                <p className="text-xs text-muted-foreground mb-1">Current Price</p>
                <p className="text-2xl font-medium tabular-nums">${currentPrice.toFixed(2)}</p>
                {pnlPct !== 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={cn('text-sm font-light tabular-nums', isPos ? 'text-emerald-500' : 'text-red-500')}>
                      {isPos ? '+' : '−'}${Math.abs(pnl / trade.shares).toFixed(2)}
                    </span>
                    <PnlBadge value={pnlPct} />
                  </div>
                )}
              </div>
              {/* Right: your position */}
              <div className="flex-1 p-4">
                <p className="text-xs text-muted-foreground mb-1">Your Position</p>
                <p className="text-2xl font-medium tabular-nums">
                  ${(currentPrice * trade.shares).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </p>
                <p className="text-sm text-muted-foreground tabular-nums mt-1">
                  {trade.shares} shares · ${trade.entryPrice.toFixed(2)} entry
                </p>
              </div>
            </div>

            {/* TradingView chart */}
            <div className="border-t">
              <TradingViewWidget
                scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
                config={chartConfig}
                height={400}
              />
            </div>

            {/* Stats grid below chart: 3x2 */}
            <div className="grid grid-cols-3 border-t divide-x">
              {[
                { label: 'Entry', value: `$${trade.entryPrice.toFixed(2)}` },
                { label: 'Target', value: `$${targetPrice.toFixed(2)}`, cls: 'text-emerald-500' },
                { label: 'Stop', value: `$${stopPrice.toFixed(2)}`, cls: 'text-red-500' },
                { label: 'R:R Ratio', value: `${riskReward.toFixed(2)}:1` },
                { label: 'Confidence', value: `${trade.thesis?.confidenceScore ?? '—'}%` },
                { label: 'Hold', value: trade.thesis?.holdDuration ?? 'Swing' },
              ].map((stat) => (
                <div key={stat.label} className="px-4 py-2.5 text-center">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className={cn('text-sm font-medium tabular-nums mt-0.5', stat.cls)}>
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Thesis body (NOT in a card) */}
          {trade.thesis && (
            <div className="space-y-3">
              <h2 className="text-lg font-medium">Thesis</h2>
              <p className="text-base text-muted-foreground leading-relaxed">
                {trade.thesis.reasoningSummary}
              </p>
            </div>
          )}

          {/* Bulls / Bears 2-col card */}
          {(thesisBullets.length > 0 || riskFlags.length > 0) && (
            <Card className="overflow-hidden shadow-none p-0">
              <CardContent className="p-0">
                <div className="grid grid-cols-2 divide-x min-h-[120px]">
                  {/* Bulls */}
                  <div className="p-4 bg-gradient-to-br from-emerald-400/10 via-emerald-400/2 to-emerald-400/0 flex flex-col gap-4">
                  
                    <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 border-none rounded-lg">
                      Bull Case
                    </Badge>
                    <div className="space-y-2">
                      {thesisBullets.map((b, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="text-foreground/80 leading-snug">{b}</span>
                        </div>
                      ))}
                      {thesisBullets.length === 0 && (
                        <p className="text-xs text-muted-foreground">No bull points recorded</p>
                      )}
                    </div>
                  </div>
                  {/* Bears */}
                  <div className="p-4 bg-gradient-to-br from-red-400/10 via-red-400/2 to-red-400/0 flex flex-col gap-4">
                    <Badge variant="secondary" className="bg-red-500/15 text-red-700 border-none rounded-lg">
                      Bear Case
                    </Badge>
                    <div className="space-y-2">
                      {riskFlags.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="text-foreground/70 leading-snug">{r}</span>
                        </div>
                      ))}
                      {riskFlags.length === 0 && (
                        <p className="text-xs text-muted-foreground">No risk flags recorded</p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Post-mortem evaluation */}
          {evalEvent && (
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
          )}

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
                            <span className={cn('ml-1', event.pnlAt >= 0 ? 'text-emerald-500' : 'text-red-500')}>
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
        </div>

        {/* ════ RIGHT column ════ */}
        <div className="hidden lg:block w-80 shrink-0 space-y-4">

          {/* Info card: key-value pairs */}
          <Card className="shadow-none p-0">
            <CardContent className="p-3 flex flex-col gap-1">
              {[
                { label: 'Direction', value: trade.direction },
                { label: 'Entry Price', value: `$${trade.entryPrice.toFixed(2)}` },
                { label: 'Current Price', value: `$${currentPrice.toFixed(2)}` },
                { label: 'Shares', value: String(trade.shares) },
                { label: 'Position Cost', value: `$${positionCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}` },
                { label: 'Market Value', value: `$${(currentPrice * trade.shares).toLocaleString('en-US', { maximumFractionDigits: 0 })}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
                </div>
              ))}

              <div className="pt-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{isOpen ? 'Unrealized P&L' : 'Realized P&L'}</span>
                  <span className={cn('font-medium tabular-nums', isPos ? 'text-emerald-500' : 'text-red-500')}>
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
                {trade.closedAt && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Closed</span>
                    <span className="font-medium tabular-nums text-xs">
                      {new Date(trade.closedAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric',
                      })}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Target visualization */}
          <Card className="shadow-none">
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-medium">Target Progress</h3>

              {/* 10-segment bar */}
              <div className="space-y-2">
                <div className="flex gap-[2px]">
                  {Array.from({ length: 10 }).map((_, i) => {
                    const segmentPct = (i + 1) * 10;
                    const isFilled = progressPct >= segmentPct;
                    return (
                      <div
                        key={i}
                        className={cn(
                          'h-2 flex-1',
                          i === 0 && 'rounded-l-full',
                          i === 9 && 'rounded-r-full',
                          isFilled
                            ? isPos ? 'bg-emerald-500' : 'bg-red-500'
                            : 'bg-muted'
                        )}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                  <span>${stopPrice.toFixed(2)} stop</span>
                  <span className="font-medium text-foreground">{progressPct}%</span>
                  <span>${targetPrice.toFixed(2)} target</span>
                </div>
              </div>

              {/* Key levels */}
              <div className="space-y-1.5 border-t pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Entry</span>
                  <span className="tabular-nums">${trade.entryPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-500">Target</span>
                  <span className="tabular-nums text-emerald-500">
                    ${targetPrice.toFixed(2)}
                    <span className="text-muted-foreground ml-1">
                      +{(((targetPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-red-500">Stop</span>
                  <span className="tabular-nums text-red-500">
                    ${stopPrice.toFixed(2)}
                    <span className="text-muted-foreground ml-1">
                      −{(((trade.entryPrice - stopPrice) / trade.entryPrice) * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
