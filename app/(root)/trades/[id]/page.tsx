import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
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
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  ArrowDownUp,
  AlertCircle,
  Brain,
  ExternalLink,
} from 'lucide-react';

// ─── Event icon map ─────────────────────────────────────────────────────────

function EventIcon({ type }: { type: string }) {
  switch (type) {
    case 'PLACED':      return <ArrowDownUp className="h-3.5 w-3.5" />;
    case 'NEAR_TARGET': return <Target className="h-3.5 w-3.5 text-amber-500" />;
    case 'CLOSED':      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'EVALUATED':   return <Brain className="h-3.5 w-3.5 text-primary" />;
    default:            return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// ─── Status helpers ──────────────────────────────────────────────────────────

function getStatusDisplay(status: string, outcome: string | null) {
  if (status === 'OPEN') return { label: 'Open',       cls: 'border-primary/40 text-primary' };
  if (outcome === 'WIN')  return { label: 'Target Hit', cls: 'border-emerald-500/40 text-emerald-500' };
  if (outcome === 'LOSS') return { label: 'Stop Hit',   cls: 'border-red-500/40 text-red-500' };
  return { label: 'Closed', cls: 'border-muted-foreground/40 text-muted-foreground' };
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

  const isOpen    = trade.status === 'OPEN';
  const currentPrice = trade.closePrice ?? trade.entryPrice;

  // P&L
  const realizedPnl  = trade.realizedPnl ?? 0;
  const unrealizedDollars = isOpen
    ? trade.direction === 'LONG'
      ? (currentPrice - trade.entryPrice) * trade.shares
      : (trade.entryPrice - currentPrice) * trade.shares
    : realizedPnl;
  const positionCost = trade.entryPrice * trade.shares;
  const pnl          = isOpen ? unrealizedDollars : realizedPnl;
  const pnlPct       = positionCost > 0 ? (pnl / positionCost) * 100 : 0;
  const isPos        = pnl >= 0;

  const status      = getStatusDisplay(trade.status, trade.outcome ?? null);
  const targetPrice = trade.targetPrice ?? trade.entryPrice * 1.1;
  const stopPrice   = trade.stopLoss    ?? trade.entryPrice * 0.9;

  // Progress to target
  const totalMove  = Math.abs(
    trade.direction === 'LONG' ? targetPrice - trade.entryPrice : trade.entryPrice - targetPrice
  );
  const actualMove = Math.abs(
    trade.direction === 'LONG' ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice
  );
  const progressPct = totalMove > 0
    ? Math.min(100, Math.max(0, Math.round((actualMove / totalMove) * 100)))
    : 0;

  const riskMove   = Math.abs(
    trade.direction === 'LONG' ? trade.entryPrice - stopPrice : stopPrice - trade.entryPrice
  );
  const riskReward = riskMove > 0 ? totalMove / riskMove : 0;

  // Analyst + run info from thesis
  const analystName = trade.thesis?.researchRun?.agentConfig?.name ?? null;
  const analystId   = trade.thesis?.researchRun?.agentConfig?.id   ?? null;
  const runId       = trade.thesis?.researchRun?.id                 ?? null;

  // Post-mortem eval event
  const evalEvent = trade.events.find((e) => e.eventType === 'EVALUATED');

  const chartConfig = {
    ...CANDLE_CHART_WIDGET_CONFIG,
    symbol: `NASDAQ:${trade.ticker}`,
  };

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      {/* Back nav */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground -ml-2"
        render={<Link href="/trades" />}
      >
        <ArrowLeft className="h-4 w-4" />
        Paper Trades
      </Button>

      {/* ── Trade Header ── */}
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold tabular-nums tracking-tight">{trade.ticker}</h1>
          <Badge
            variant="outline"
            className={cn(
              'text-xs font-semibold',
              trade.direction === 'LONG'
                ? 'border-primary/50 text-primary'
                : 'border-amber-500/50 text-amber-500'
            )}
          >
            {trade.direction}
          </Badge>
          <Badge variant="outline" className={cn('text-xs', status.cls)}>
            {isOpen && (
              <span className="mr-1 relative flex h-1.5 w-1.5 inline-block">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
            )}
            {status.label}
          </Badge>
        </div>

        <div className="flex items-baseline gap-3 pt-1">
          <span className="text-4xl font-semibold tabular-nums">${currentPrice.toFixed(2)}</span>
          <span className={cn('text-lg tabular-nums font-medium flex items-center gap-1', isPos ? 'text-emerald-500' : 'text-red-500')}>
            {isPos ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {isPos ? '+' : ''}${Math.abs(pnl).toFixed(2)} ({isPos ? '+' : ''}{pnlPct.toFixed(2)}%)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground pt-0.5">
          <span>
            Opened {new Date(trade.openedAt).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </span>
          <span>·</span>
          <span>Conf: {trade.thesis?.confidenceScore ?? '—'}%</span>
          <span>·</span>
          <span>Hold: {trade.thesis?.holdDuration ?? 'Swing'}</span>
          {trade.closedAt && (
            <>
              <span>·</span>
              <span>Closed {new Date(trade.closedAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}</span>
            </>
          )}
          {analystName && analystId && (
            <>
              <span>·</span>
              <Link href={`/analysts/${analystId}`} className="hover:text-foreground transition-colors">
                {analystName}
              </Link>
            </>
          )}
          {runId && (
            <>
              <span>·</span>
              <Link href={`/runs/${runId}`} className="hover:text-foreground transition-colors inline-flex items-center gap-0.5">
                View run <ExternalLink className="h-3 w-3" />
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Closed result banner ── */}
      {!isOpen && (
        <div className={cn(
          'rounded-lg border px-4 py-3 text-sm font-medium flex items-center gap-2',
          trade.outcome === 'WIN'
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-500'
            : 'border-red-500/30 bg-red-500/5 text-red-500'
        )}>
          {trade.outcome === 'WIN'  && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {trade.outcome === 'LOSS' && <XCircle       className="h-4 w-4 shrink-0" />}
          {(!trade.outcome || trade.outcome === 'BREAKEVEN') && <Clock className="h-4 w-4 shrink-0" />}
          {status.label} · Realized P&amp;L:{' '}
          {isPos ? '+' : ''}${Math.abs(realizedPnl).toFixed(2)}{' '}
          ({isPos ? '+' : ''}{pnlPct.toFixed(2)}%)
        </div>
      )}

      {/* ── Price Chart ── */}
      <Card className="border-border">
        <CardContent className="p-0 overflow-hidden rounded-lg">
          <TradingViewWidget
            scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
            config={chartConfig}
            height={360}
          />
        </CardContent>
      </Card>

      {/* ── Progress to target (open trades only) ── */}
      {isOpen && (
        <Card className="border-border">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Progress to target</span>
              <span className="font-medium tabular-nums text-foreground">{progressPct}% complete</span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>Entry ${trade.entryPrice.toFixed(2)}</span>
              <span>Target ${targetPrice.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Trade Parameters + Thesis ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Parameters */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Trade Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { icon: ArrowDownUp, label: 'Entry',  value: `$${trade.entryPrice.toFixed(2)}` },
              {
                icon: Target,
                label: 'Target',
                value: `$${targetPrice.toFixed(2)} (+${(((targetPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(1)}%)`,
              },
              {
                icon: ShieldAlert,
                label: 'Stop',
                value: `$${stopPrice.toFixed(2)} (-${(((trade.entryPrice - stopPrice) / trade.entryPrice) * 100).toFixed(1)}%)`,
              },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </div>
                <span className="text-sm font-medium tabular-nums">{value}</span>
              </div>
            ))}
            <Separator />
            {[
              { label: 'R:R Ratio',      value: `${riskReward.toFixed(2)}:1` },
              { label: 'Shares',         value: String(trade.shares) },
              { label: 'Position Value', value: `$${(currentPrice * trade.shares).toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
              { label: 'Exit Strategy',  value: trade.exitStrategy },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium tabular-nums">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Full thesis */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Thesis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {trade.thesis ? (
              <>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {trade.thesis.reasoningSummary}
                </p>

                {/* All bullish/bearish bullets */}
                {(trade.thesis.thesisBullets as string[]).length > 0 && (
                  <div className="space-y-1.5">
                    {(trade.thesis.thesisBullets as string[]).map((b, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <span className="text-foreground/80 leading-snug">{b}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* All risk flags */}
                {(trade.thesis.riskFlags as string[]).length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risks</p>
                      {(trade.thesis.riskFlags as string[]).map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                          <span className="text-foreground/70 leading-snug">{r}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No thesis attached to this trade.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Post-mortem evaluation ── */}
      {evalEvent && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              Post-Mortem Evaluation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {evalEvent.description}
            </p>
            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              Evaluated {new Date(evalEvent.createdAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Trade Event Log ── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Event Log</CardTitle>
        </CardHeader>
        <CardContent>
          {trade.events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No events recorded yet.</p>
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
                        Price: ${event.priceAt.toFixed(2)}
                        {event.pnlAt != null && ` · P&L: ${event.pnlAt >= 0 ? '+' : ''}$${event.pnlAt.toFixed(2)}`}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                      {new Date(event.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
