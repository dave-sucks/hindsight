import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import TradingViewWidget from '@/components/TradingViewWidget';
import { CANDLE_CHART_WIDGET_CONFIG } from '@/lib/constants';
import { mockResearchRuns } from '@/lib/mock-data/research';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  AlertTriangle,
  ExternalLink,
  Newspaper,
  BarChart2,
  MessageSquare,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

// Mock sources
const MOCK_SOURCES = [
  {
    id: 's1',
    type: 'news' as const,
    provider: 'Reuters',
    title: 'Data center demand drives chip shortfall into 2027',
    date: '2026-03-01',
    url: '#',
  },
  {
    id: 's2',
    type: 'filing' as const,
    provider: 'SEC EDGAR',
    title: 'Q4 2025 Earnings Call Transcript',
    date: '2026-02-20',
    url: '#',
  },
  {
    id: 's3',
    type: 'analysis' as const,
    provider: 'FinRobot Analysis',
    title: 'Technical pattern: Bull flag on 4H chart with volume confirmation',
    date: '2026-03-01',
    url: '#',
  },
];

const SOURCE_ICONS = {
  news: Newspaper,
  filing: BarChart2,
  analysis: MessageSquare,
};

function DirectionBadge({ direction }: { direction: string }) {
  const map: Record<string, string> = {
    LONG: 'border-primary/50 text-primary',
    SHORT: 'border-amber-500/50 text-amber-500',
    NEUTRAL: 'border-muted-foreground/50 text-muted-foreground',
  };
  return (
    <Badge variant="outline" className={cn('text-sm font-semibold', map[direction] ?? '')}>
      {direction}
    </Badge>
  );
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ThesisDetailPage({ params }: Props) {
  const { id } = await params;

  const thesis = mockResearchRuns.find((r) => r.id === id);

  if (!thesis) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <div className="text-center">
          <p className="text-2xl font-semibold text-foreground mb-2">Thesis Not Found</p>
          <p className="text-sm text-muted-foreground">
            No thesis found for ID: <span className="font-mono">{id}</span>
          </p>
        </div>
        <Button variant="outline" render={<Link href="/research" />}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Research
        </Button>
      </div>
    );
  }

  const upside = (((thesis.targetPrice - thesis.entryPrice) / thesis.entryPrice) * 100).toFixed(1);
  const downside = (((thesis.stopPrice - thesis.entryPrice) / thesis.entryPrice) * 100).toFixed(1);
  const isLong = thesis.direction === 'LONG';

  // Simulated closed state for demonstration
  const isClosed = thesis.id === 'thesis-1'; // treat first as "closed" for demo

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Back nav */}
      <Link
        href="/research"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Research
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4 justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold font-mono text-foreground tracking-tight">
              {thesis.ticker}
            </h1>
            <DirectionBadge direction={thesis.direction} />
            <Badge variant="outline" className={cn(
              'text-xs',
              isClosed
                ? 'border-muted-foreground/40 text-muted-foreground'
                : 'border-primary/40 text-primary'
            )}>
              {isClosed ? 'Closed' : 'Active'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{thesis.companyName}</p>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Confidence</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{thesis.confidenceScore}</p>
          </div>
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">R:R</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-500">{thesis.riskReward.toFixed(2)}x</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Chart + Trade Parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* TradingView chart — 60% */}
        <div className="lg:col-span-3">
          <TradingViewWidget
            scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
            config={CANDLE_CHART_WIDGET_CONFIG(thesis.ticker)}
            height={480}
          />
        </div>

        {/* Trade parameters — 40% */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-medium">Trade Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Entry', value: `$${thesis.entryPrice.toFixed(2)}`, sub: null },
                {
                  label: 'Target',
                  value: `$${thesis.targetPrice.toFixed(2)}`,
                  sub: `${isLong ? '+' : '-'}${Math.abs(Number(upside))}%`,
                  subClass: 'text-emerald-500',
                },
                {
                  label: 'Stop',
                  value: `$${thesis.stopPrice.toFixed(2)}`,
                  sub: `${isLong ? '' : '+'}${downside}%`,
                  subClass: 'text-red-500',
                },
                { label: 'R:R Ratio', value: `${thesis.riskReward.toFixed(2)}:1`, sub: null },
                { label: 'Hold Duration', value: thesis.holdDuration, sub: null },
              ].map(({ label, value, sub, subClass }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <div className="flex items-center gap-2 tabular-nums">
                    <span className="text-sm font-semibold text-foreground">{value}</span>
                    {sub && (
                      <span className={cn('text-xs font-medium tabular-nums', subClass)}>{sub}</span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Risk Flags */}
          {thesis.riskFlags.length > 0 && (
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-medium text-amber-500">Risk Flags</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {thesis.riskFlags.map((r, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="border-amber-500/30 text-amber-500 gap-1"
                  >
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {r.flag}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* AI Thesis reasoning */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg font-medium">AI Thesis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{thesis.summary}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The thesis is grounded in a combination of fundamental analysis and technical price action.
            Data-CoT agent identified the core macro and micro drivers, while Concept-CoT validated
            the hypothesis against historical analog setups. Thesis-CoT synthesized both inputs into
            the structured trade parameters above.
          </p>

          <Separator />

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
              Thesis Points
            </p>
            <div className="space-y-2.5">
              {thesis.bullets.map((b, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span className="text-foreground/85 leading-relaxed">{b.point}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sources */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg font-medium">Sources Used</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {MOCK_SOURCES.map((source) => {
            const Icon = SOURCE_ICONS[source.type];
            return (
              <div
                key={source.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
              >
                <div className="h-7 w-7 rounded bg-secondary flex items-center justify-center shrink-0">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">{source.provider}</p>
                  <p className="text-sm text-foreground leading-snug line-clamp-2 mt-0.5">
                    {source.title}
                  </p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground">{source.date}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground/50" />
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Post-trade evaluation — only shown when closed */}
      {isClosed && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg font-medium">Post-Trade Evaluation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Outcome', value: 'Target Hit', class: 'text-emerald-500' },
                { label: 'AI Verdict', value: 'Thesis Confirmed', class: 'text-emerald-500' },
                { label: 'Final P&L', value: '+$46.00', class: 'text-emerald-500' },
                { label: 'Accuracy', value: '91%', class: 'text-foreground' },
              ].map(({ label, value, class: cls }) => (
                <div key={label} className="text-center">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    {label}
                  </p>
                  <p className={cn('text-lg font-semibold tabular-nums', cls)}>{value}</p>
                </div>
              ))}
            </div>
            <Separator />
            <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                AI thesis accuracy confirmed — data center demand accelerated as predicted.
                Target reached in 17 days (within swing window). Stop was not triggered.
                All 3 primary thesis points validated by post-trade analysis.
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
