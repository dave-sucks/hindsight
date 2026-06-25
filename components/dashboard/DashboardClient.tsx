'use client';

import { useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { SlidersHorizontal, ArrowRight } from 'lucide-react';

import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent } from '@/components/ui/card';
import { TickBar, type Tick } from '@/components/ui/gauge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TradeRow as SharedTradeRow } from '@/components/ui/trade-row';
import CoverageTable from '@/components/dashboard/CoverageTable';
import type { CoverageData } from '@/lib/actions/coverage.actions';
import { StockLogo } from '@/components/StockLogo';
import { Badge } from '@/components/ui/badge';
import { ThesisRow, type ThesisRowData } from '@/components/ui/thesis-row';
import type { StockCandle } from '@/lib/actions/finnhub.actions';
import { getThesisStatusDisplay, type ThesisStatus } from '@/lib/thesis-status';
import { ProposalActions } from '@/components/proposals/ProposalActions';
import { OnboardingChecklist } from '@/components/domain/onboarding-checklist';
import type { LatestDigest } from '@/lib/actions/digest.actions';
import { DigestMarkdown } from '@/components/ui/ticker-markdown';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyStateBg } from '@/components/domain/empty-state-bg';
import { ProductTourDialog } from '@/components/domain/onboarding-flow';
import { Button } from '@/components/ui/button';
import { PriceChange } from '@/components/ui/price-change';
import { buildTradeSentence } from '@/lib/trade-statement';
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipProvider as UITooltipProvider,
  TooltipTrigger as UITooltipTrigger,
} from '@/components/ui/tooltip';
import {
  mockOpenTrades,
  mockEquityCurve,
  mockPortfolio,
  type MockTrade,
} from '@/lib/mock-data/trades';
import type { DashboardData, RecentPick, ActivityFeedItem } from '@/lib/actions/portfolio.actions';
import { useTradeRealtime, type RealtimeTrade } from '@/hooks/useTradeRealtime';
import { toast } from 'sonner';
import { cn, PNL_HEX } from '@/lib/utils';
import { formatCurrency, formatDateLabel } from '@/lib/format';

// ─── Constants ────────────────────────────────────────────────────────────────

const RANGES = ['1D', '1W', '1M', '1Y', 'Max'] as const;
type Range = (typeof RANGES)[number];

const RANGE_DAYS: Record<Range, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '1Y': 365,
  Max: 99999,
};

// Header label for the P&L figure — tracks the selected range so the green
// number is unambiguously "P&L over this window" (e.g. "1 Week P&L").
const RANGE_PNL_LABEL: Record<Range, string> = {
  '1D': '1 Day P&L',
  '1W': '1 Week P&L',
  '1M': '1 Month P&L',
  '1Y': '1 Year P&L',
  Max: 'All Time P&L',
};

type ChartView = 'portfolio' | 'by-analyst' | 'vs-spy';
type DisplayMode = 'dollar' | 'percent';
// 'equity' = total account value (real money in the account, deposits included).
// The other three are deposit-adjusted P&L (gains) flavors. 'equity' is the
// default so the chart matches the BALANCE figure; the gains views are filters.
type ShowMode = 'equity' | 'both' | 'realized' | 'unrealized';

const ANALYST_COLORS = [
  '#6366f1',
  '#f59e0b',
  '#10b981',
  '#f43f5e',
  '#8b5cf6',
  '#06b6d4',
];

const TICK_STYLE = { fontSize: 9, fill: '#71717a', fontFamily: 'var(--font-mono)' };

const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  fontSize: '12px',
  color: 'var(--popover-foreground)',
};

// ─── Data helpers ─────────────────────────────────────────────────────────────

function cutoffMs(range: Range) {
  return Date.now() - RANGE_DAYS[range] * 86_400_000;
}

function filterByRange<T extends { date: string }>(data: T[], range: Range): T[] {
  const ms = cutoffMs(range);
  const filtered = data.filter((d) => new Date(d.date + 'T12:00:00').getTime() >= ms);
  return filtered.length > 1 ? filtered : data.slice(-2);
}

/**
 * Build wide-format multi-analyst chart data with index keys (a0, a1, ...).
 * Normalizes each curve as % of $100K starting capital to avoid division-by-zero.
 */
function buildAnalystCompareData(
  analysts: { id: string; name: string }[],
  curves: Record<string, { date: string; value: number }[]>,
  range: Range,
): Record<string, number | string>[] {
  if (analysts.length === 0) return [];

  const maps = new Map<string, Map<string, number>>();
  for (let i = 0; i < analysts.length; i++) {
    const raw = filterByRange(curves[analysts[i].id] ?? [], range);
    if (raw.length === 0) continue;
    const m = new Map<string, number>();
    for (const pt of raw) {
      m.set(pt.date, (pt.value / 100_000) * 100);
    }
    maps.set(`a${i}`, m);
  }
  if (maps.size === 0) return [];

  const allDates = new Set<string>();
  for (const m of maps.values()) for (const d of m.keys()) allDates.add(d);
  const sortedDates = [...allDates].sort();

  return sortedDates.map((date) => {
    const row: Record<string, number | string> = { date };
    for (const [key, m] of maps.entries()) {
      const v = m.get(date);
      if (v !== undefined) row[key] = v;
    }
    return row;
  });
}

/**
 * Build two-line % comparison: portfolio vs SPY.
 */
function buildSpyCompareData(
  equityCurve: { date: string; value: number }[],
  spyCandles: { date: string; close: number }[],
  range: Range,
): { date: string; portfolio: number; spy: number }[] {
  const portSlice = filterByRange(equityCurve, range);
  const spySlice = filterByRange(spyCandles.map((c) => ({ date: c.date, value: c.close })), range);
  if (portSlice.length < 2 || spySlice.length < 2) return [];

  const portBase = portSlice[0].value;
  const spyBase = spySlice[0].value;
  if (portBase === 0 || spyBase === 0) return [];

  const spyMap = new Map(spySlice.map((d) => [d.date, d.value]));

  return portSlice
    .filter((d) => spyMap.has(d.date))
    .map((d) => ({
      date: d.date,
      portfolio: ((d.value - portBase) / portBase) * 100,
      spy: ((spyMap.get(d.date)! - spyBase) / spyBase) * 100,
    }));
}

// ─── Home bottom section (Theses + Activity tabs) ────────────────────────────

type ThesisTabFilter = 'ALL' | ThesisStatus;
// Canonical display order for the thesis sub-filter tabs. Only statuses
// actually present in the feed render a tab (see `presentStatuses`).
const THESIS_STATUS_ORDER: ThesisStatus[] = [
  'HOLDING',
  'WATCHING',
  'PASSED',
  'RETIRED',
  'PROMOTED',
];
const THESIS_PAGE_SIZE = 10;
type ActivityTabFilter = 'all' | 'opens' | 'closes' | 'updates';

function relTime(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'Today';
  if (d === 1) return '1d ago';
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  if (d.toDateString() === today) return 'Today';
  if (d.toDateString() === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function groupActivityByDay(items: ActivityFeedItem[]) {
  const groups: { label: string; items: ActivityFeedItem[] }[] = [];
  for (const item of items) {
    const lbl = dayLabel(item.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.label === lbl) { last.items.push(item); }
    else { groups.push({ label: lbl, items: [item] }); }
  }
  return groups;
}


// Mirrors ACTION_STATUS from decision-summary-card.tsx
const ACTIVITY_ACTION_STATUS: Record<string, { label: string; dotClass: string; tooltip: string }> = {
  INITIATE: { label: 'Bought',        dotClass: 'bg-positive',                tooltip: 'New position opened' },
  SHORT:    { label: 'Shorted',       dotClass: 'bg-negative',                tooltip: 'Short position opened' },
  ADD:      { label: 'Add',           dotClass: 'bg-positive',                tooltip: 'Added to existing position' },
  REDUCE:   { label: 'Reduce',        dotClass: 'bg-amber-500',               tooltip: 'Trimmed position size' },
  EXIT:     { label: 'Sold',          dotClass: 'bg-muted-foreground/60',     tooltip: 'Position closed' },
  HOLD:     { label: 'Hold',          dotClass: 'bg-muted-foreground/40',     tooltip: 'Monitoring — no action taken' },
  WATCH:    { label: 'Watch',         dotClass: 'bg-blue-500',                tooltip: 'Added to watchlist' },
  STOP:     { label: 'Stop Moved',    dotClass: 'bg-amber-500',               tooltip: 'Stop loss level adjusted' },
  NEAR_TGT: { label: 'Near Target',   dotClass: 'bg-positive',                tooltip: 'Price approaching target' },
  NEAR_STP: { label: 'Near Stop',     dotClass: 'bg-negative',                tooltip: 'Price approaching stop loss' },
  // Trade-as-Proposal — see docs/plans/TRADE_AS_PROPOSAL.md
  PROPOSED: { label: 'Pending Review', dotClass: 'bg-amber-500',              tooltip: 'Awaiting your approval' },
  REJECTED: { label: 'Rejected',       dotClass: 'bg-muted-foreground/40',    tooltip: 'Proposal rejected — never executed' },
};

function getDecisionAction(item: ActivityFeedItem): string {
  if (item.type === 'PROPOSED') return 'PROPOSED';
  if (item.type === 'REJECTED') return 'REJECTED';
  if (item.type === 'OPENED') return item.direction === 'SHORT' ? 'SHORT' : 'INITIATE';
  if (item.type === 'CLOSED') return 'EXIT';
  const lbl = item.label.toLowerCase();
  if (lbl.includes('partial') || lbl.includes('reduc')) return 'REDUCE';
  if (lbl.includes('add')) return 'ADD';
  if (lbl.includes('near target') || lbl.includes('approaching target')) return 'NEAR_TGT';
  if (lbl.includes('near stop') || lbl.includes('approaching stop')) return 'NEAR_STP';
  if (lbl.includes('stop')) return 'STOP';
  if (lbl.includes('watch')) return 'WATCH';
  return 'HOLD';
}

function getActivitySentence(item: ActivityFeedItem): string {
  const src = item.source === 'price_monitor' ? 'price monitor' : item.source === 'user' ? 'you' : 'the agent';
  if (item.type === 'OPENED') {
    return item.direction === 'SHORT'
      ? `Short position opened in ${item.symbol} by ${src}.`
      : `Long position opened in ${item.symbol} by ${src}.`;
  }
  if (item.type === 'CLOSED') {
    if (item.pnl != null) {
      const sign = item.pnl >= 0 ? '+' : '';
      const amt = `${sign}$${Math.abs(item.pnl).toFixed(2)}`;
      const pct = item.pnlPct != null ? ` (${sign}${item.pnlPct.toFixed(1)}%)` : '';
      return item.pnl >= 0
        ? `Closed for a profit of ${amt}${pct} by ${src}.`
        : `Closed at a loss of ${amt}${pct} by ${src}.`;
    }
    return `Position closed by ${src}.`;
  }
  if (item.reason) return `${item.reason} (via ${src}).`;
  return `${item.label} via ${src}.`;
}

function pickToThesisRow(pick: RecentPick, candles?: StockCandle[]): ThesisRowData {
  return {
    id: pick.id,
    ticker: pick.ticker,
    direction: pick.direction,
    status: pick.status,
    confidenceScore: pick.confidenceScore,
    reasoningSummary: pick.reasoningSummary,
    entryPrice: pick.entryPrice,
    targetPrice: pick.targetPrice,
    stopLoss: pick.stopLoss,
    // True thesis-creation date — anchors the chart's "Watching" marker and
    // the footer timestamp. (Previously overridden to the position's openedAt
    // for holdings, which would have collapsed the Watching marker onto Entry.)
    createdAt: pick.createdAt,
    currentPrice: pick.currentPrice,
    candles,
    companyName: pick.companyName,
    analystName: pick.analystName,
    analystId: pick.analystId,
    runId: pick.runId,
    sourcesUsed: pick.sourcesUsed,
    decision: pick.decision,
    position: pick.position
      ? {
          id: pick.position.id,
          status: pick.position.status,
          tradeStatus: pick.position.tradeStatus,
          avgCost: pick.position.avgCost,
          quantity: pick.position.quantity,
          openedAt: pick.position.openedAt,
          filledAt: pick.position.filledAt,
          placedAt: pick.position.placedAt,
        }
      : null,
  };
}


function ActivityRow({ item }: { item: ActivityFeedItem }) {
  const actionKey = getDecisionAction(item);
  const status = ACTIVITY_ACTION_STATUS[actionKey] ?? ACTIVITY_ACTION_STATUS.HOLD;
  // Trade-as-Proposal — render inline [Approve][Reject] when this row is
  // awaiting the user's decision. See docs/plans/TRADE_AS_PROPOSAL.md.
  const isProposed = item.type === 'PROPOSED' && item.orderId != null;

  // The middle text + right side, built per event type. Trade events
  // (Bought / Sold / Proposed buy) use the SHARED buildTradeSentence so the
  // feed reads identically to the thesis sheet / row / trades-page; the gain
  // renders via <PriceChange> (same green/red ↗ styling, no opaque parens).
  // Non-trade events (Hold / Near-Stop / etc) keep their prose reason.
  let middle: string | null = null;
  let gain: { dollar: number; pct: number | null } | null = null;
  const hasSize = item.shares != null && item.price != null;

  if (item.type === 'OPENED' && hasSize) {
    // Event-log buy — just "Bought N shares at $X" (no "now trading at").
    middle = buildTradeSentence({ kind: 'holding', qty: item.shares!, entry: item.price! });
  } else if (isProposed && hasSize) {
    middle = buildTradeSentence({ kind: 'proposed-buy', qty: item.shares!, entry: item.price! });
  } else if (item.type === 'REJECTED' && hasSize) {
    // Rejected/expired proposal — describe the would-be buy; no P&L (nothing executed).
    middle = buildTradeSentence({ kind: 'proposed-buy', qty: item.shares!, entry: item.price! });
  } else if (item.type === 'CLOSED' && hasSize) {
    middle = buildTradeSentence({
      kind: 'closed',
      qty: item.shares!,
      entry: item.price!,
      closePrice: item.closePrice ?? null,
    });
    if (item.pnl != null) gain = { dollar: item.pnl, pct: item.pnlPct };
  } else {
    middle = getActivitySentence(item);
  }

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <Link
            href={`/trades/${item.positionId}`}
            className="flex items-center gap-1.5 rounded-md p-2 hover:bg-muted/70 transition-colors"
          />
        }
      >
        <StockLogo ticker={item.symbol} size="sm" />
        <span className="text-sm font-semibold font-brand shrink-0 mr-1">{item.symbol}</span>
        <Badge variant="secondary" className="gap-1.5 font-normal shrink-0">
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', status.dotClass)} />
          {status.label}
        </Badge>
        {middle ? (
          <span className="flex-1 min-w-0 text-xs text-muted-foreground tabular-nums truncate">
            {middle}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {gain && <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="sm" />}
          {isProposed && <ProposalActions orderId={item.orderId!} />}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <StockLogo ticker={item.symbol} size="md" />
            <span className="text-base font-semibold font-brand">{item.symbol}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 font-normal">
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', status.dotClass)} />
              {status.label}
            </Badge>
            {gain && <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="sm" />}
          </div>
          <p className="text-sm text-muted-foreground">{middle ?? getActivitySentence(item)}</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function HomeBottomSection({ picks, activity, loading, coverage }: {
  picks: RecentPick[];
  activity: ActivityFeedItem[];
  loading: boolean;
  coverage?: CoverageData;
}) {
  const [tab, setTab] = useState<'portfolio' | 'theses' | 'activity'>('portfolio');
  const [thesisFilter, setThesisFilter] = useState<ThesisTabFilter>('ALL');
  const [thesisPage, setThesisPage] = useState(0);
  const [activityFilter, setActivityFilter] = useState<ActivityTabFilter>('all');
  const [showTour, setShowTour] = useState(false);

  // Sub-filter tabs: "All" + each thesis status actually present in the feed,
  // in canonical order. Pure status names — no special-case logic. Labels come
  // from the shared status display map so they never drift from the pills.
  const thesisTabs = useMemo<{ key: ThesisTabFilter; label: string }[]>(() => {
    const present = new Set(picks.map((p) => p.status));
    return [
      { key: 'ALL' as const, label: 'All' },
      ...THESIS_STATUS_ORDER.filter((s) => present.has(s)).map((s) => ({
        key: s,
        label: getThesisStatusDisplay(s).label,
      })),
    ];
  }, [picks]);

  const filteredPicks = useMemo(
    () => (thesisFilter === 'ALL' ? picks : picks.filter((p) => p.status === thesisFilter)),
    [picks, thesisFilter],
  );

  // Paginate — only ~10 cards (and their charts) mount at once, so a long feed
  // doesn't render dozens of charts. Reset to page 0 when the filter changes.
  useEffect(() => {
    setThesisPage(0);
  }, [thesisFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredPicks.length / THESIS_PAGE_SIZE));
  const safePage = Math.min(thesisPage, pageCount - 1);
  const pagedPicks = useMemo(
    () => filteredPicks.slice(safePage * THESIS_PAGE_SIZE, safePage * THESIS_PAGE_SIZE + THESIS_PAGE_SIZE),
    [filteredPicks, safePage],
  );

  // Batched candles for the inline card charts — only the visible page's
  // chartable rows (WATCHING/HOLDING). One request, ≤10 symbols, ~40 days for
  // the fixed 1M window. See docs/plans/THESIS_VISUALIZATION.md §4.
  const chartTickers = useMemo(
    () =>
      [
        ...new Set(
          pagedPicks
            .filter((p) => p.status === 'WATCHING' || p.status === 'HOLDING')
            .map((p) => p.ticker),
        ),
      ].sort(),
    [pagedPicks],
  );
  const chartKey = chartTickers.join(',');
  const [candlesByTicker, setCandlesByTicker] = useState<Record<string, StockCandle[]>>({});
  useEffect(() => {
    if (!chartKey) return;
    let cancelled = false;
    fetch(`/api/stocks/candles?symbols=${encodeURIComponent(chartKey)}&days=40`)
      .then(async (r) => {
        if (!r.ok) return;
        const json = (await r.json()) as { candles: Record<string, StockCandle[]> };
        // Merge so paging back doesn't refetch / flicker already-loaded names.
        if (!cancelled) setCandlesByTicker((prev) => ({ ...prev, ...json.candles }));
      })
      .catch(() => {
        /* non-fatal — cards just render without a chart */
      });
    return () => {
      cancelled = true;
    };
  }, [chartKey]);

  const filteredActivity = activity.filter((a) => {
    if (activityFilter === 'opens') return a.type === 'OPENED';
    if (activityFilter === 'closes') return a.type === 'CLOSED';
    if (activityFilter === 'updates') return a.type === 'MODIFIED';
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    );
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-0">
      {/* Tab bar + filter dropdown */}
      <div className="flex items-center justify-between pb-3">
        {/* Custom pill tabs — bigger text, no wrapper BG, subtle active state */}
        <div className="flex items-center gap-0.5">
          {([
            { value: 'portfolio', label: 'Portfolio' },
            { value: 'activity', label: 'Activity' },
            { value: 'theses', label: 'Theses' },
          ] as const).map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-colors',
                tab === t.value
                  ? 'bg-muted/70 text-foreground font-medium'
                  : 'text-muted-foreground/60 hover:text-muted-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Activity filter dropdown — only shown on the Activity tab */}
        <div>
          {tab === 'activity' && (
            <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as ActivityTabFilter)}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="opens">Opens</SelectItem>
                <SelectItem value="closes">Closes</SelectItem>
                <SelectItem value="updates">Updates</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Portfolio — Coverage table with pill-style sub-filter. */}
      <TabsContent value="portfolio">
        <div className="space-y-5">
          {coverage ? (
            <CoverageTable data={coverage} />
          ) : (
            <Card className="shadow-none">
              <CardContent className="py-8 flex justify-center">
                <p className="text-sm text-muted-foreground">No coverage data yet.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </TabsContent>

      {/* Theses list */}
      <TabsContent value="theses">
        {picks.length === 0 ? (
          <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl py-24 px-4">
            <div
              className="absolute inset-0"
              style={{
                maskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
                maskComposite: 'intersect',
                WebkitMaskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
                WebkitMaskComposite: 'source-in',
              }}
            >
              <EmptyStateBg />
            </div>
            <div className="relative z-10 flex flex-col items-center gap-3">
              <p className="text-base font-medium text-center">Theses for your Stocks appear after Agents run</p>
              <p className="text-sm text-muted-foreground text-center max-w-xs">
                Your analyst will research stocks, generate theses, and place paper trades autonomously.
              </p>
              <div className="flex items-center gap-2">
                <Link href="/analysts" className="inline-flex items-center justify-center h-8 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-muted">
                  Create an Analyst
                </Link>
                <Button variant="ghost" size="sm" onClick={() => setShowTour(true)}>Product Overview</Button>
              </div>
              <ProductTourDialog open={showTour} onOpenChange={setShowTour} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Status sub-filter — mini-tabs (same pattern as the Trades page).
                Pure status names; only statuses present in the feed appear. */}
            <div className="flex w-fit items-center gap-0.5 rounded-md border bg-muted/50 px-1 py-0.5">
              {thesisTabs.map((ft) => (
                <button
                  key={ft.key}
                  onClick={() => setThesisFilter(ft.key)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded transition-colors',
                    thesisFilter === ft.key
                      ? 'bg-background text-foreground font-medium shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {ft.label}
                </button>
              ))}
            </div>

            {filteredPicks.length === 0 ? (
              <Card className="shadow-none">
                <CardContent className="py-8 flex justify-center">
                  <p className="text-sm text-muted-foreground">No theses match this filter.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {pagedPicks.map((pick) => (
                  <ThesisRow
                    key={pick.id}
                    thesis={pickToThesisRow(pick, candlesByTicker[pick.ticker.toUpperCase()])}
                    showTicker={true}
                  />
                ))}
                {pageCount > 1 && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {safePage * THESIS_PAGE_SIZE + 1}–
                      {Math.min((safePage + 1) * THESIS_PAGE_SIZE, filteredPicks.length)} of{' '}
                      {filteredPicks.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage === 0}
                        onClick={() => setThesisPage((p) => Math.max(0, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={safePage >= pageCount - 1}
                        onClick={() => setThesisPage((p) => Math.min(pageCount - 1, p + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </TabsContent>

      {/* Activity list */}
      <TabsContent value="activity">
        {activity.length === 0 ? (
          <Card className="shadow-none">
            <CardContent className="py-8 flex flex-col items-center gap-1">
              <p className="text-sm text-muted-foreground">No activity yet</p>
              <p className="text-xs text-muted-foreground/60">Trades and position changes appear here as analysts run.</p>
            </CardContent>
          </Card>
        ) : filteredActivity.length === 0 ? (
          <Card className="shadow-none">
            <CardContent className="py-8 flex justify-center">
              <p className="text-sm text-muted-foreground">No activity matches this filter.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groupActivityByDay(filteredActivity).map((group) => (
              <div key={group.label}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 px-1 pb-1.5">{group.label}</p>
                <Card className="p-1 gap-1">
                  {group.items.map((item) => <ActivityRow key={item.id} item={item} />)}
                </Card>
              </div>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}


function DashboardTradeRow({ trade, flash }: { trade: MockTrade; flash?: 'win' | 'loss' }) {
  return (
    <SharedTradeRow
      id={trade.id}
      ticker={trade.ticker}
      currentPrice={trade.currentPrice}
      entryPrice={trade.entryPrice}
      shares={trade.shares}
      pnl={trade.pnl ?? 0}
      pnlPct={trade.pnlPct ?? 0}
      status={trade.status}
      placedAt={trade.placedAt}
      filledAt={trade.filledAt}
      closedAt={trade.closedAt}
      priceSource={trade.priceSource}
      priceUpdatedAt={trade.priceUpdatedAt}
      alpacaOrderId={trade.alpacaOrderId}
      flash={flash}
      pendingProposal={trade.pendingProposal}
      thesisId={trade.thesisId}
      direction={trade.direction}
    />
  );
}

function Empty({ text, subtext }: { text: string; subtext?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-1.5 px-4">
      <p className="text-sm text-muted-foreground text-center">{text}</p>
      {subtext && (
        <p className="text-xs text-muted-foreground/60 text-center">{subtext}</p>
      )}
    </div>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return (
    <div className="h-52 flex items-center justify-center">
      <p className="text-xs text-muted-foreground text-center max-w-xs px-4">{text}</p>
    </div>
  );
}

// Small uppercase divider separating the "Pending approval" proposals from the
// "Held" positions inside the Open tab. Matches the activity-feed day-group
// label style so the lists stay visually consistent. Only shown when both
// groups are present — a plain held list renders unlabeled, as before.
function PositionGroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 px-3 pt-3 pb-1.5">
      {children}
    </p>
  );
}

// ── DigestPreviewCard ─────────────────────────────────────────────────────────
// Compact teaser above the positions list. Shows the digest date + ~160 chars
// of narrative (stripped of markdown) with a bottom fade, click opens dialog.

function stripMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, '$1')        // **bold**
    .replace(/\*([^*]+)\*/g, '$1')            // *italic*
    .replace(/^#+\s/gm, '')                    // headings
    .replace(/`[^`]*`/g, '')                   // code
    .trim();
}

function formatDigestDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function DigestPreviewCard({
  digest,
}: {
  digest: LatestDigest | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (digest === undefined) return null;

  const preview = digest ? stripMarkdown(digest.narrative).slice(0, 420) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => digest && setOpen(true)}
        className={cn(
          'w-full text-left rounded-lg border bg-card p-3 mb-3',
          digest ? 'hover:brightness-[0.98] transition-all cursor-pointer' : 'cursor-default',
        )}
      >
        <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-1">
          {digest ? `${formatDigestDate(digest.date)} · after close` : 'Portfolio Digest'}
        </p>
        {digest && preview ? (
          <div className="relative">
            <p className="text-base font-medium leading-relaxed line-clamp-6">
              {preview}
            </p>
            {/* Subtle fade so the clamped narrative trails off into the card. */}
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-card to-transparent pointer-events-none" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No digest yet — generates after close.</p>
        )}
      </button>

      {digest && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-2xl p-0">
            <DialogHeader className="px-5 pt-5 pb-3 border-b">
              <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                {formatDigestDate(digest.date)} · after close
              </p>
              <DialogTitle className="text-base font-semibold">Portfolio Digest</DialogTitle>
            </DialogHeader>
            <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
              <DigestMarkdown>{digest.narrative}</DigestMarkdown>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── PositionsPanel — Open / Closed trades list ───────────────────────────────
//
// The portfolio's open + closed positions as a two-tab Card. Rendered in two
// places: the desktop right rail (w-80) and, on mobile where the rail is
// hidden, inline in the main column between the stat tiles and the
// Activity/Theses tabs — so the trade list (the thing the user cares about
// most) is never hidden on a phone. Kept as one component so both surfaces
// stay in sync.
function PositionsPanel({
  openTrades,
  pendingTrades,
  loading,
  flashIds,
  digest,
}: {
  openTrades: MockTrade[];
  pendingTrades: MockTrade[];
  loading: boolean;
  flashIds: Map<string, 'win' | 'loss'>;
  digest?: LatestDigest | null;
}) {
  return (
    <div className="space-y-0">
      <DigestPreviewCard digest={digest} />
      <Card className="shadow-none p-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-1 px-4 pt-1 pb-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : openTrades.length === 0 && pendingTrades.length === 0 ? (
            <Empty
              text="No open positions"
              subtext="Positions appear when an analyst places a paper trade during a run."
            />
          ) : (
            <div>
              {pendingTrades.map((t) => (
                <DashboardTradeRow key={t.id} trade={t} flash={flashIds.get(t.id)} />
              ))}
              {openTrades.map((t) => (
                <DashboardTradeRow key={t.id} trade={t} flash={flashIds.get(t.id)} />
              ))}
            </div>
          )}
          <div className="border-t border-border/40 px-3 py-2">
            <Link
              href="/trades"
              className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
            >
              All Trades
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── DashboardClient ──────────────────────────────────────────────────────────

interface DashboardClientProps {
  data?: DashboardData;
  userId?: string;
  /**
   * Optional Daily Portfolio Digest (Feature A). When provided (even if null,
   * which renders the empty state), the PortfolioDigestCard renders inside the
   * Overview tab of the bottom tabbed section. Omitting the prop entirely hides
   * the digest card.
   */
  digest?: LatestDigest | null;
  /**
   * Coverage Table data (Feature B — docs/plans/PORTFOLIO_DIGEST.md). When
   * present, the Active/Watching/Passed coverage tables render inside the
   * Overview tab, beneath the digest brief. Additive — omitting it just drops
   * the tables.
   */
  coverage?: CoverageData;
}

export default function DashboardClient({ data, userId, digest, coverage }: DashboardClientProps) {
  const [range, setRange] = useState<Range>('1M');
  const [chartView, setChartView] = useState<ChartView>('portfolio');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('dollar');
  const [showMode, setShowMode] = useState<ShowMode>('equity');
  const [realtimeClosedIds, setRealtimeClosedIds] = useState<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Map<string, 'win' | 'loss'>>(new Map());

  const handlePositionUpdate = useCallback((position: RealtimeTrade) => {
    if (position.status === 'CLOSED' || position.status.startsWith('CLOSED_')) {
      const result = position.outcome === 'WIN' ? 'win' : 'loss';
      setFlashIds((prev) => new Map(prev).set(position.id, result));
      toast[result === 'win' ? 'success' : 'error'](
        `${position.symbol} closed — ${result === 'win' ? '✅ WIN' : '❌ LOSS'}`,
        {
          description:
            position.realizedPnl != null
              ? `P&L: $${position.realizedPnl.toFixed(2)}`
              : undefined,
        },
      );
      setTimeout(() => {
        setFlashIds((prev) => {
          const m = new Map(prev);
          m.delete(position.id);
          return m;
        });
        setRealtimeClosedIds((prev) => new Set(prev).add(position.id));
      }, 1200);
    }
  }, []);

  useTradeRealtime({ userId: userId ?? '', onPositionUpdate: handlePositionUpdate });

  // ── Raw data ────────────────────────────────────────────────────────────────
  const openTrades = (data?.openTrades ?? mockOpenTrades).filter(
    (t) => !realtimeClosedIds.has(t.id),
  );
  // Pending buy proposals (Position.status === PENDING_APPROVAL). Kept separate
  // from held positions so they render in their own "Pending approval" group
  // and never inflate the "Open" count. No mock fallback — empty in mock mode.
  const pendingTrades = data?.pendingTrades ?? [];
  const closedTrades = data?.closedTrades ?? [];
  const analysts = data?.analysts ?? [];
  const analystEquityCurves = data?.analystEquityCurves ?? {};
  const spyBenchmark = data?.spyBenchmark ?? { '1W': null, '1M': null, '1Y': null };
  const spyCandles = data?.spyCandles ?? [];
  const recentPicks = data?.recentPicks ?? [];

  const rawEquity = data && data.equityCurve.length > 0 ? data.equityCurve : mockEquityCurve;
  const rawRealizedCurve = data?.realizedCurve ?? rawEquity;
  // Deposit-adjusted cumulative P&L (equity − net contributions). Drives the
  // default "Total" view + the header delta so a deposit isn't read as a gain.
  // Equals rawEquity when there are no funding events (paper / mock).
  const rawPnlCurve = data && data.pnlCurve.length > 0 ? data.pnlCurve : rawEquity;

  // Derive the active curve based on showMode. 'equity' plots the raw account
  // value (real money, deposits included) — the default; the other modes are
  // deposit-adjusted P&L flavors.
  const activeCurve = useMemo(() => {
    if (showMode === 'equity') return rawEquity;
    if (showMode === 'realized') return rawRealizedCurve;
    if (showMode === 'unrealized') {
      // unrealizedPnl at each date = total equity - (startCapital + realizedPnl)
      // realizedCurve[i].value = startCapital + realizedPnl_at_date
      // equityCurve[i].value   = startCapital + realizedPnl + unrealizedPnl
      // → unrealizedPnl = equityCurve - realizedCurve
      // → unrealizedCurve.value = startCapital + unrealizedPnl
      const startCapital = rawRealizedCurve.length > 0 ? rawRealizedCurve[0].value : 100_000;
      const realizedMap = new Map(rawRealizedCurve.map((p) => [p.date, p.value]));
      return rawEquity.map((p) => {
        const realized = realizedMap.get(p.date) ?? startCapital;
        const unrealizedPnl = p.value - realized;
        return { date: p.date, value: startCapital + unrealizedPnl };
      });
    }
    return rawPnlCurve; // 'both' — deposit-adjusted total P&L (equity − contributions)
  }, [showMode, rawEquity, rawRealizedCurve, rawPnlCurve]);

  const portfolio = data?.portfolio ?? {
    totalValue: mockPortfolio.totalValue,
    unrealizedPnl: mockPortfolio.dayChange,
    realizedPnl: mockPortfolio.totalPnl,
    winRate: 0.6,
    openCount: mockOpenTrades.length,
    // Mock fallback — never rendered in prod, just satisfies the type.
    netPositionValue: 0,
    positionMarketValue: 0,
    longMarketValue: 0,
    shortMarketValue: 0,
    cash: mockPortfolio.totalValue,
    buyingPower: mockPortfolio.totalValue,
    usingMargin: false,
    leverageRatio: 1,
    totalPnl: mockPortfolio.totalPnl,
    accountReturnPct: 0,
    netContributed: 100_000,
    dayPnl: 0,
    dayPnlPct: 0,
  };

  // ── Chart data (memoized) ───────────────────────────────────────────────────
  const portfolioData = useMemo(
    () => filterByRange(activeCurve, range),
    [activeCurve, range],
  );

  // Header P&L series — ALWAYS the deposit-adjusted P&L curve, independent of
  // which curve the chart is showing. The header "{Range} P&L" is the headline
  // trading gain net of deposits; if it followed `activeCurve` it would read the
  // raw equity delta in the default Account Value view and count a deposit as a
  // gain (the exact bug this page keeps regressing into).
  const pnlData = useMemo(
    () => filterByRange(rawPnlCurve, range),
    [rawPnlCurve, range],
  );

  // Raw equity over the same range — used only as the % denominator (the
  // capital actually at work). The active curve is deposit-adjusted P&L, whose
  // first point is ~0 at inception; dividing by THAT would explode the %.
  const equityRange = useMemo(() => filterByRange(rawEquity, range), [rawEquity, range]);

  // ── Portfolio header values ─────────────────────────────────────────────────
  const totalValueStr = formatCurrency(portfolio.totalValue);

  // Range-aware P&L: delta over the selected range from the active (filtered)
  // curve. Because that curve is deposit-adjusted, the delta is pure trading
  // P&L — a deposit inside the window cancels out instead of showing as a gain.
  const rangePnl = pnlData.length >= 2
    ? pnlData[pnlData.length - 1].value - pnlData[0].value
    : portfolio.totalPnl;
  // % base: capital at the start of the window. All-Time divides by net
  // contributed capital so "total return" = gain ÷ money-you-put-in; shorter
  // ranges divide by the equity at the range start.
  const rangePnlBase = range === 'Max'
    ? (portfolio.netContributed > 0 ? portfolio.netContributed : (equityRange[0]?.value ?? 0))
    : (equityRange[0]?.value ?? portfolio.netContributed);
  const rangePnlPct = rangePnlBase > 0 ? (rangePnl / rangePnlBase) * 100 : 0;
  const pnlPositive = rangePnl >= 0;

  const spyPct: number | null =
    range === '1W' ? spyBenchmark['1W']
    : range === '1M' ? spyBenchmark['1M']
    : range === '1Y' ? spyBenchmark['1Y']
    : null;

  // % return curve over the selected range. value is deposit-adjusted P&L, so
  // express each point as P&L-since-range-start ÷ capital-at-range-start. This
  // starts at 0, is deposit-flat, and never divides by the ~0 inception P&L.
  const portfolioPercentData = useMemo(() => {
    if (portfolioData.length < 2) return portfolioData;
    const pnlBase = portfolioData[0].value;
    const capitalBase = equityRange[0]?.value ?? portfolio.netContributed;
    if (!capitalBase) return portfolioData.map((d) => ({ ...d, value: 0 }));
    return portfolioData.map((d) => ({
      date: d.date,
      value: ((d.value - pnlBase) / capitalBase) * 100,
    }));
  }, [portfolioData, equityRange, portfolio.netContributed]);

  // % Return is a gains concept — it's undefined for raw Account Value (and
  // would fold deposits into the denominator). So the percent transform only
  // applies to the P&L views; Account Value always renders in dollars.
  const chartPercent = displayMode === 'percent' && showMode !== 'equity';
  const activePortfolioData = chartPercent ? portfolioPercentData : portfolioData;

  const analystCompareData = useMemo(
    () => buildAnalystCompareData(analysts, analystEquityCurves, range),
    [analysts, analystEquityCurves, range],
  );

  const spyCompareData = useMemo(
    () => buildSpyCompareData(rawEquity, spyCandles, range),
    [rawEquity, spyCandles, range],
  );

  // ── Chart visuals ───────────────────────────────────────────────────────────
  // strokeColor is derived from pnlPositive (same range delta) so chart and header always agree
  const strokeColor = pnlPositive ? PNL_HEX.positive : PNL_HEX.negative;

  const analystChartConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    analysts.forEach((analyst, i) => {
      cfg[`a${i}`] = {
        label: analyst.name,
        color: ANALYST_COLORS[i % ANALYST_COLORS.length],
      };
    });
    return cfg;
  }, [analysts]);

  const spyChartConfig = useMemo<ChartConfig>(
    () => ({
      portfolio: { label: 'Portfolio', color: strokeColor },
      spy: { label: 'S&P 500', color: '#71717a' },
    }),
    [strokeColor],
  );

  const loading = !data;

  const hasPortfolioData = activePortfolioData.length >= 2;
  const hasAnalystData = analystCompareData.length >= 2 && analysts.length >= 1;
  const hasSpyData = spyCompareData.length >= 2;

  const effectiveView: ChartView =
    chartView === 'by-analyst' && analysts.length === 0 ? 'portfolio'
    : chartView === 'vs-spy' && spyCandles.length === 0 ? 'portfolio'
    : chartView;

  return (
    <div className="overflow-y-auto h-[calc(100dvh-3rem)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-6 items-start">

          {/* ══ LEFT column ══════════════════════════════════════════════════ */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Layout: graph first (balance → chart → stat tiles), then the
                tabbed section (Overview = brief + coverage tables / Activity /
                Theses). The digest + coverage live inside the Overview tab —
                see HomeBottomSection — not as standalone sections. */}

            {/* Portfolio header — two labeled figures, mirroring a broker
                statement: "BALANCE" over total account equity, and
                "{RANGE} P&L" over the deposit-adjusted gain for the selected
                window. The P&L is net of deposits/withdrawals, so funding the
                account never reads as a gain. Both values are text-xl for
                equal visual weight; mobile stacks them, desktop sits them
                side by side. */}
            <div className="space-y-0.5 lg:h-16">
              {loading ? (
                <Skeleton className="h-16 w-80" />
              ) : (
                <UITooltipProvider>
                  {/* Balance + P&L columns. Win Rate moved to the right rail
                      (it doubles as the rail's top-alignment spacer). */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-10">
                    {/* Balance column — value first, then "Balance ($X available)" on one line */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xl font-semibold tabular-nums">
                        {totalValueStr}
                      </span>
                      <UITooltip>
                        <UITooltipTrigger render={
                          <span className="text-xs text-muted-foreground cursor-default w-fit">
                            <span className="font-medium">Balance</span>
                            <span className="font-light"> ({formatCurrency(portfolio.cash)} available)</span>
                          </span>
                        } />
                        <UITooltipContent side="bottom">
                          <div className="text-xs space-y-0.5">
                            <div>Available cash</div>
                            {portfolio.netPositionValue > 0 && (
                              <div className="opacity-70">
                                {formatCurrency(portfolio.netPositionValue)} invested in positions
                              </div>
                            )}
                          </div>
                        </UITooltipContent>
                      </UITooltip>
                    </div>

                    {/* P&L column — value first, then "{Range} P&L (+$X unrealized)" on one line */}
                    <div className="flex flex-col gap-0.5">
                      <PriceChange
                        dollarChange={rangePnl}
                        percentChange={rangePnlPct}
                        size="xl"
                      />
                      <span className="text-xs text-muted-foreground tabular-nums">
                        <span className="font-medium">{RANGE_PNL_LABEL[range]}</span>
                        <span className="font-light"> ({portfolio.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(portfolio.unrealizedPnl)} unrealized)</span>
                      </span>
                    </div>
                  </div>
                </UITooltipProvider>
              )}
            </div>

            {/* Chart card */}
            <div
              className="rounded-lg overflow-hidden border"
              style={{
                backgroundImage:
                  'radial-gradient(circle, var(--border) 1px, transparent 1px)',
                backgroundSize: '18px 18px',
                backgroundColor: 'var(--card)',
              }}
            >
              {/* Controls: range tabs (left) + settings dropdown (right) */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 gap-2">
                {/* Range tabs */}
                <div className="flex items-center gap-0.5 rounded-md border bg-muted/50 px-1 py-0.5">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={cn(
                        'px-2.5 py-1 text-xs rounded transition-colors',
                        range === r
                          ? 'bg-background text-foreground font-medium shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                {/* Settings dropdown */}
                {!loading && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" />}>
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>View</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={effectiveView}
                          onValueChange={(v) => setChartView(v as ChartView)}
                        >
                          <DropdownMenuRadioItem value="portfolio">Portfolio</DropdownMenuRadioItem>
                          {analysts.length > 0 && (
                            <DropdownMenuRadioItem value="by-analyst">By Analyst</DropdownMenuRadioItem>
                          )}
                          {spyCandles.length > 0 && (
                            <DropdownMenuRadioItem value="vs-spy">vs S&amp;P 500</DropdownMenuRadioItem>
                          )}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                      {effectiveView === 'portfolio' && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Show</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={showMode}
                              onValueChange={(v) => setShowMode(v as ShowMode)}
                            >
                              <DropdownMenuRadioItem value="equity">Account Value</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="both">Total Gain (Realized + Unrealized)</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="realized">Realized Gain</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="unrealized">Unrealized Gain</DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Display</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={displayMode}
                              onValueChange={(v) => setDisplayMode(v as DisplayMode)}
                            >
                              <DropdownMenuRadioItem value="dollar">$ Value</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="percent">% Return</DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                          </DropdownMenuGroup>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* Chart render */}
              {loading ? (
                <div className="h-[260px] flex items-center justify-center">
                  <Skeleton className="h-1 w-3/4 rounded-full" />
                </div>
              ) : effectiveView === 'portfolio' ? (
                !hasPortfolioData ? (
                  <ChartEmpty text="The equity chart tracks portfolio value over time as trades open and close." />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart
                      data={activePortfolioData}
                      margin={{ top: 4, right: 0, bottom: 0, left: chartPercent ? 4 : 0 }}
                    >
                      <defs>
                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={strokeColor} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatDateLabel(v).toUpperCase()}
                        interval={Math.max(1, Math.floor(activePortfolioData.length / 6))}
                        padding={{ left: 0, right: 0 }}
                      />
                      {chartPercent ? (
                        <YAxis
                          tick={TICK_STYLE}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`}
                          width={44}
                          domain={['dataMin', 'dataMax']}
                        />
                      ) : (
                        <YAxis hide domain={['dataMin * 0.999', 'dataMax * 1.001']} />
                      )}
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v) => [
                          chartPercent
                            ? `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`
                            : `$${Number(v).toLocaleString()}`,
                          'Portfolio',
                        ]}
                        labelFormatter={(l: unknown) => formatDateLabel(String(l))}
                        labelStyle={{ color: 'var(--muted-foreground)' }}
                        itemStyle={{ color: 'var(--foreground)' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={strokeColor}
                        strokeWidth={1.5}
                        fill="url(#eqGrad)"
                        dot={false}
                        activeDot={{ r: 3, fill: strokeColor }}
                        baseValue="dataMin"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )
              ) : effectiveView === 'by-analyst' ? (
                !hasAnalystData ? (
                  <ChartEmpty text="Not enough trade history to compare analysts yet." />
                ) : (
                  <ChartContainer config={analystChartConfig} className="h-[260px] w-full">
                    <LineChart
                      data={analystCompareData}
                      margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                    >
                      <XAxis
                        dataKey="date"
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatDateLabel(String(v)).toUpperCase()}
                        interval={Math.max(1, Math.floor(analystCompareData.length / 6))}
                        padding={{ left: 8, right: 8 }}
                      />
                      <YAxis
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`}
                        width={48}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div style={TOOLTIP_STYLE} className="grid min-w-36 gap-1 rounded-lg px-2.5 py-1.5">
                              <p className="text-xs text-muted-foreground">{formatDateLabel(String(label))}</p>
                              {payload.map((item) => {
                                const key = item.dataKey as string;
                                const name = (analystChartConfig[key]?.label as string) ?? key;
                                const pct = Number(item.value);
                                return (
                                  <div key={key} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-1.5">
                                      <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                      <span className="text-xs text-muted-foreground">{name}</span>
                                    </div>
                                    <span className="text-xs font-mono font-medium tabular-nums text-foreground">
                                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      <ChartLegend
                        content={({ payload }) => {
                          if (!payload?.length) return null;
                          return (
                            <div className="flex items-center justify-center gap-2.5 pt-2">
                              {payload.filter((item) => item.type !== 'none').map((item) => {
                                const key = item.dataKey as string;
                                const label = (analystChartConfig[key]?.label as string) ?? key;
                                return (
                                  <div key={key} title={label} className="h-2 w-2 rounded-full cursor-default" style={{ backgroundColor: item.color }} />
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      {analysts.map((_, i) => (
                        <Line
                          key={`a${i}`}
                          type="monotone"
                          dataKey={`a${i}`}
                          stroke={`var(--color-a${i})`}
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ChartContainer>
                )
              ) : (
                !hasSpyData ? (
                  <ChartEmpty text="Not enough data to compare against S&P 500 for this range." />
                ) : (
                  <ChartContainer config={spyChartConfig} className="h-[260px] w-full">
                    <LineChart
                      data={spyCompareData}
                      margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                    >
                      <XAxis
                        dataKey="date"
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => formatDateLabel(String(v)).toUpperCase()}
                        interval={Math.max(1, Math.floor(spyCompareData.length / 6))}
                        padding={{ left: 8, right: 8 }}
                      />
                      <YAxis
                        tick={TICK_STYLE}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`}
                        width={48}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div style={TOOLTIP_STYLE} className="grid min-w-32 gap-1 rounded-lg px-2.5 py-1.5">
                              <p className="text-xs text-muted-foreground">{formatDateLabel(String(label))}</p>
                              {payload.map((item) => {
                                const pct = Number(item.value);
                                const name = item.dataKey === 'portfolio' ? 'Portfolio' : 'S&P 500';
                                return (
                                  <div key={item.dataKey as string} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-1.5">
                                      <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                      <span className="text-xs text-muted-foreground">{name}</span>
                                    </div>
                                    <span className="text-xs font-mono font-medium tabular-nums text-foreground">
                                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Line
                        type="monotone"
                        dataKey="portfolio"
                        stroke="var(--color-portfolio)"
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="spy"
                        stroke="var(--color-spy)"
                        strokeWidth={1.5}
                        strokeDasharray="4 2"
                        dot={false}
                        activeDot={{ r: 3 }}
                      />
                    </LineChart>
                  </ChartContainer>
                )
              )}
            </div>


            {/* Positions — mobile only. The desktop right rail is hidden
                below lg, so render the trade list inline here (chart → stats →
                trades → activity) so it's reachable on a phone. */}
            <div className="lg:hidden">
              <PositionsPanel
                openTrades={openTrades}
                pendingTrades={pendingTrades}
                loading={loading}
                flashIds={flashIds}
                digest={digest}
              />
            </div>

            {/* Portfolio / Activity / Theses tabbed section. */}
            <HomeBottomSection
              picks={recentPicks}
              activity={data?.activityFeed ?? []}
              loading={loading}
              coverage={coverage}
            />
          </div>

          {/* ══ RIGHT column — positions (desktop only) ════════════════════ */}
          <div className="hidden lg:block w-80 shrink-0">
            {/* Win Rate — sized h-16 + mb-5 to mirror the left header (metrics
                height + space-y-5 gap), so it doubles as the spacer that aligns
                the digest card with the top of the chart card. */}
            <UITooltipProvider>
              <UITooltip>
                <UITooltipTrigger render={
                  <div className="flex h-16 flex-col items-end justify-center gap-1.5 mb-5 cursor-default">
                    <TickBar
                      ticks={Array.from({ length: 10 }, (_, i): Tick => ({
                        color: portfolio.winRate != null && i < Math.round(portfolio.winRate * 10)
                          ? 'bg-foreground'
                          : 'bg-muted-foreground/25',
                      }))}
                      className="w-16"
                    />
                    <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                      Win Rate
                    </span>
                  </div>
                } />
                <UITooltipContent side="bottom" align="end">
                  <div className="text-xs">
                    {portfolio.winRate != null
                      ? `${Math.round(portfolio.winRate * 100)}% win rate`
                      : 'No closed trades yet'}
                  </div>
                </UITooltipContent>
              </UITooltip>
            </UITooltipProvider>
            <PositionsPanel
              openTrades={openTrades}
              pendingTrades={pendingTrades}
              loading={loading}
              flashIds={flashIds}
              digest={digest}
            />
          </div>

        </div>
      </div>

      {!loading && (
        <OnboardingChecklist
          hasAlpacaKey={data?.hasAlpacaKey ?? false}
          hasAnalyst={(data?.analystCount ?? 0) > 0}
          hasCompletedRun={data?.hasCompletedRun ?? false}
          hasBrief={data?.hasBrief ?? false}
        />
      )}
    </div>
  );
}
