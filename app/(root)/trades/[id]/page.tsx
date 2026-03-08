import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import TradingViewWidget from '@/components/TradingViewWidget';
import { CANDLE_CHART_WIDGET_CONFIG } from '@/lib/constants';
import { mockOpenTrades, mockClosedTrades } from '@/lib/mock-data/trades';
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
} from 'lucide-react';

// ─── Mock event log ───────────────────────────────────────────────────────────

interface TradeEvent {
  at: string;
  description: string;
  type: 'PLACED' | 'PRICE_CHECK' | 'CLOSED_WIN' | 'CLOSED_LOSS' | 'CLOSED_EXPIRED' | 'MANUAL_CLOSE';
}

function getMockEvents(tradeId: string): TradeEvent[] {
  const base: TradeEvent[] = [
    { at: 'Mar 1, 2026 · 9:31 AM', description: 'Trade placed at $875.00 via Alpaca Paper', type: 'PLACED' },
    { at: 'Mar 1, 2026 · 5:00 PM', description: 'Price check: $881.40 (+0.7%). Target at 8.0%.', type: 'PRICE_CHECK' },
    { at: 'Mar 2, 2026 · 5:00 PM', description: 'Price check: $902.10 (+3.1%). Target at 5.5%.', type: 'PRICE_CHECK' },
    { at: 'Mar 3, 2026 · 5:00 PM', description: 'Price check: $912.80 (+4.3%). Target at 4.2%.', type: 'PRICE_CHECK' },
    { at: 'Mar 7, 2026 · 5:00 PM', description: 'Price check: $921.40 (+5.3%). Target at 3.1%.', type: 'PRICE_CHECK' },
  ];

  const allTrades = [...mockOpenTrades, ...mockClosedTrades];
  const trade = allTrades.find((t) => t.id === tradeId);
  if (!trade) return base;

  if (trade.status === 'CLOSED_WIN') {
    return [...base, { at: trade.closedAt ?? 'Mar 10, 2026', description: `Target hit at $${trade.targetPrice.toFixed(2)} — realized +$${Math.abs(trade.pnl).toFixed(2)}`, type: 'CLOSED_WIN' }];
  }
  if (trade.status === 'CLOSED_LOSS') {
    return [...base, { at: trade.closedAt ?? 'Mar 10, 2026', description: `Stop hit at $${trade.stopPrice.toFixed(2)} — realized -$${Math.abs(trade.pnl).toFixed(2)}`, type: 'CLOSED_LOSS' }];
  }
  if (trade.status === 'CLOSED_EXPIRED') {
    return [...base, { at: trade.closedAt ?? 'Mar 10, 2026', description: `Thesis expired — trade closed at market price`, type: 'CLOSED_EXPIRED' }];
  }
  return base;
}

const EVENT_ICON: Record<TradeEvent['type'], React.ReactNode> = {
  PLACED: <ArrowDownUp className="h-3.5 w-3.5" />,
  PRICE_CHECK: <TrendingUp className="h-3.5 w-3.5" />,
  CLOSED_WIN: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  CLOSED_LOSS: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  CLOSED_EXPIRED: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  MANUAL_CLOSE: <XCircle className="h-3.5 w-3.5 text-muted-foreground" />,
};

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_MAP = {
  OPEN: { label: 'Open', cls: 'border-primary/40 text-primary' },
  CLOSED_WIN: { label: 'Target Hit', cls: 'border-emerald-500/40 text-emerald-500' },
  CLOSED_LOSS: { label: 'Stop Hit', cls: 'border-red-500/40 text-red-500' },
  CLOSED_EXPIRED: { label: 'Expired', cls: 'border-muted-foreground/40 text-muted-foreground' },
} as const;

const COMPANY_NAMES: Record<string, string> = {
  NVDA: 'NVIDIA Corporation', TSLA: 'Tesla Inc', AAPL: 'Apple Inc',
  META: 'Meta Platforms', COIN: 'Coinbase Global', MSFT: 'Microsoft Corp',
  GOOGL: 'Alphabet Inc', SNAP: 'Snap Inc', NFLX: 'Netflix Inc',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trade = [...mockOpenTrades, ...mockClosedTrades].find((t) => t.id === id);
  if (!trade) notFound();

  const isOpen = trade.status === 'OPEN';
  const isPos = trade.pnl >= 0;
  const status = STATUS_MAP[trade.status];
  const company = COMPANY_NAMES[trade.ticker] ?? trade.ticker;
  const events = getMockEvents(trade.id);

  // Progress to target (0% at entry, 100% at target price)
  const totalMove = Math.abs(
    trade.direction === 'LONG'
      ? trade.targetPrice - trade.entryPrice
      : trade.entryPrice - trade.targetPrice
  );
  const actualMove = Math.abs(
    trade.direction === 'LONG'
      ? trade.currentPrice - trade.entryPrice
      : trade.entryPrice - trade.currentPrice
  );
  const progressPct = Math.min(100, Math.max(0, Math.round((actualMove / totalMove) * 100)));

  const riskReward = totalMove / Math.abs(
    trade.direction === 'LONG'
      ? trade.entryPrice - trade.stopPrice
      : trade.stopPrice - trade.entryPrice
  );

  const chartConfig = {
    ...CANDLE_CHART_WIDGET_CONFIG,
    symbol: `NASDAQ:${trade.ticker}`,
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Back nav */}
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground -ml-2" render={<Link href="/trades" />}>
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
              trade.direction === 'LONG' ? 'border-primary/50 text-primary' : 'border-amber-500/50 text-amber-500'
            )}
          >
            {trade.direction}
          </Badge>
          <Badge variant="outline" className={cn('text-xs', status.cls)}>
            {isOpen && <span className="mr-1 relative flex h-1.5 w-1.5 inline-block"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" /></span>}
            {status.label}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{company}</p>
        <div className="flex items-baseline gap-3 pt-1">
          <span className="text-4xl font-semibold tabular-nums">${trade.currentPrice.toFixed(2)}</span>
          <span className={cn('text-lg tabular-nums font-medium', isPos ? 'text-emerald-500' : 'text-red-500')}>
            {isPos ? <TrendingUp className="inline h-4 w-4 mr-1" /> : <TrendingDown className="inline h-4 w-4 mr-1" />}
            {isPos ? '+' : ''}${Math.abs(trade.pnl).toFixed(2)} ({isPos ? '+' : ''}{trade.pnlPct.toFixed(2)}%)
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Opened {new Date(trade.openedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}Conf: {trade.confidenceScore}%
          {' · '}Hold: Swing
          {trade.closedAt && ` · Closed ${new Date(trade.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
        </p>
      </div>

      {/* ── Closed banner ── */}
      {!isOpen && (
        <div className={cn(
          'rounded-lg border px-4 py-3 text-sm font-medium',
          trade.status === 'CLOSED_WIN' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-500' : 'border-red-500/30 bg-red-500/5 text-red-500'
        )}>
          {trade.status === 'CLOSED_WIN' && <CheckCircle2 className="inline h-4 w-4 mr-2" />}
          {trade.status === 'CLOSED_LOSS' && <XCircle className="inline h-4 w-4 mr-2" />}
          {trade.status === 'CLOSED_EXPIRED' && <Clock className="inline h-4 w-4 mr-2" />}
          {status.label} · Realized P&L: {isPos ? '+' : ''}${Math.abs(trade.pnl).toFixed(2)} ({isPos ? '+' : ''}{trade.pnlPct.toFixed(2)}%)
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

      {/* ── Progress to target ── */}
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
              <span>Target ${trade.targetPrice.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Trade Parameters + Thesis side by side ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Parameters */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Trade Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { icon: ArrowDownUp, label: 'Entry', value: `$${trade.entryPrice.toFixed(2)}` },
              { icon: Target, label: 'Target', value: `$${trade.targetPrice.toFixed(2)} (+${(((trade.targetPrice - trade.entryPrice) / trade.entryPrice) * 100).toFixed(1)}%)` },
              { icon: ShieldAlert, label: 'Stop', value: `$${trade.stopPrice.toFixed(2)} (-${(((trade.entryPrice - trade.stopPrice) / trade.entryPrice) * 100).toFixed(1)}%)` },
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
              { label: 'R:R Ratio', value: `${riskReward.toFixed(2)}:1` },
              { label: 'Shares', value: '10' },
              { label: 'Position Value', value: `$${(trade.currentPrice * 10).toLocaleString()}` },
              { label: 'Exit Strategy', value: 'Price Target' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium tabular-nums">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Thesis excerpt */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Thesis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">{trade.thesis}</p>
            <div className="space-y-1.5">
              {['AI chip demand accelerating into data center build-out cycle.', 'Strong pricing power across H100/H200 product lines.', 'Sovereign AI deals adding new revenue vector in 2026.'].map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span className="text-foreground/80 leading-snug">{b}</span>
                </div>
              ))}
            </div>
            <Separator />
            <Link
              href={`/research/cmmib76270010417j3wehcgx`}
              className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
            >
              View Full Thesis →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* ── Trade Event Log ── */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Event Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-0">
            {events.map((event, i) => (
              <div key={i} className="flex gap-3 pb-4 last:pb-0">
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center shrink-0 text-muted-foreground">
                    {EVENT_ICON[event.type]}
                  </div>
                  {i < events.length - 1 && (
                    <div className="w-px flex-1 bg-border mt-1 min-h-[16px]" />
                  )}
                </div>
                <div className="pt-0.5 pb-2">
                  <p className="text-sm text-foreground leading-snug">{event.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{event.at}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
