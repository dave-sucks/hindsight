'use client';

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { StockLogo } from '@/components/StockLogo';
import { Badge } from '@/components/ui/badge';
import { ThesisRow, type ThesisRowData } from '@/components/ui/thesis-row';
import { ProposalActions } from '@/components/proposals/ProposalActions';
import { OnboardingChecklist } from '@/components/domain/onboarding-checklist';
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
import { Info } from 'lucide-react';
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
type ShowMode = 'both' | 'realized' | 'unrealized';

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

type ThesisTabFilter = 'all' | 'open' | 'passed';
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

// ── StatTile — one cell in the portfolio stats grid below the chart ────────
//
// Responsive layout:
//   Mobile — single row per tile. Label on the left (uppercase mono muted),
//            value stretches to the right via flex-grow justify-end. This
//            is what the user asked for on narrow screens: 4 rows stacked,
//            each a horizontal label|value pair, not stacked inner content.
//   Desktop — 4-column grid. Within each tile, VALUE sits on top (text-base
//            normal weight), LABEL sits below (text-xs mono muted). Opposite
//            of the original ordering — user explicitly asked for this.
//
// `info` prop renders a tiny info button next to the label that opens a
// tooltip — used for the Position Value tile to explain semantics + surface the
// position count the label itself no longer carries.
function StatTile({
  label,
  value,
  info,
  valueClassName,
}: {
  label: string;
  value: string;
  info?: ReactNode;
  valueClassName?: string;
}) {
  // Both label and value are text-sm on every breakpoint — differentiated
  // by font-mono + uppercase + muted color on the label vs. tabular-nums
  // normal-weight default color on the value. User explicitly asked for
  // no size hierarchy here.
  const labelNode = (
    <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
      {label}
      {info}
    </span>
  );
  const valueNode = (
    <span className={cn('text-sm tabular-nums', valueClassName)}>{value}</span>
  );
  return (
    <div className="flex items-baseline justify-between gap-3 sm:flex-col-reverse sm:items-start sm:justify-start sm:gap-1">
      {labelNode}
      {valueNode}
    </div>
  );
}

function fmtTileCurrency(n: number): string {
  // Match the header — no cents, thousands separator. Large enough that
  // decimal precision is just visual noise in a stat tile.
  return '$' + Math.round(n).toLocaleString();
}

function fmtTileSigned(n: number): string {
  // Like fmtTileCurrency but always explicit sign, for deltas / cash that
  // can go negative on margin accounts. "-$7,496" reads cleaner than
  // "$-7,496" — put the sign before the $.
  const abs = '$' + Math.round(Math.abs(n)).toLocaleString();
  if (n < 0) return `-${abs}`;
  if (n > 0) return `+${abs}`;
  return abs;
}

function fmtTileCash(n: number): string {
  // Cash-specific: show NO sign when positive (a bare "$28,426" reads as
  // normal account state), show explicit '-' only when negative (borrowed
  // on margin — signals something non-default is happening).
  const abs = '$' + Math.round(Math.abs(n)).toLocaleString();
  return n < 0 ? `-${abs}` : abs;
}

function InfoPopover({ children }: { children: ReactNode }) {
  return (
    <UITooltip>
      <UITooltipTrigger render={
        <button
          type="button"
          className="inline-flex h-3 w-3 items-center justify-center text-muted-foreground/60 hover:text-foreground transition-colors cursor-help"
          aria-label="More info"
        >
          <Info className="h-3 w-3" />
        </button>
      } />
      <UITooltipContent side="top" className="max-w-[220px] text-xs normal-case font-normal tracking-normal">
        {children}
      </UITooltipContent>
    </UITooltip>
  );
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

function pickToThesisRow(pick: RecentPick): ThesisRowData {
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
    createdAt: pick.position?.openedAt ?? pick.createdAt,
    currentPrice: pick.currentPrice,
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

function HomeBottomSection({ picks, activity, loading }: {
  picks: RecentPick[];
  activity: ActivityFeedItem[];
  loading: boolean;
}) {
  const [tab, setTab] = useState<'theses' | 'activity'>('activity');
  const [thesisFilter, setThesisFilter] = useState<ThesisTabFilter>('all');
  const [activityFilter, setActivityFilter] = useState<ActivityTabFilter>('all');
  const [showTour, setShowTour] = useState(false);

  const filteredPicks = picks.filter((p) => {
    if (thesisFilter === 'open') return p.position?.status === 'OPEN';
    if (thesisFilter === 'passed') return p.direction === 'PASS' || (!p.position && p.decision !== 'BUY');
    return true;
  });

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
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="theses">Theses</TabsTrigger>
        </TabsList>

        <div>
          {tab === 'theses' ? (
            <Select value={thesisFilter} onValueChange={(v) => setThesisFilter(v as ThesisTabFilter)}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="passed">Passed</SelectItem>
              </SelectContent>
            </Select>
          ) : (
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
        ) : filteredPicks.length === 0 ? (
          <Card className="shadow-none">
            <CardContent className="py-8 flex justify-center">
              <p className="text-sm text-muted-foreground">No theses match this filter.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredPicks.map((pick) => (
              <ThesisRow key={pick.id} thesis={pickToThesisRow(pick)} showTicker={true} />
            ))}
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
  closedTrades,
  loading,
  flashIds,
}: {
  openTrades: MockTrade[];
  closedTrades: MockTrade[];
  loading: boolean;
  flashIds: Map<string, 'win' | 'loss'>;
}) {
  return (
    <Tabs defaultValue="open" className="gap-0">
      <TabsList variant="line" className="w-auto self-start px-0">
        <TabsTrigger value="open" className="px-0 mr-4">
          Open
          {openTrades.length > 0 && (
            <span className="ml-1.5 text-[10px] tabular-nums opacity-60">
              {openTrades.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="closed" className="px-0">
          Closed
          {closedTrades.length > 0 && (
            <span className="ml-1.5 text-[10px] tabular-nums opacity-60">
              {closedTrades.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <Card className="shadow-none p-0">
        <CardContent className="p-0">
          <TabsContent value="open" className="mt-0">
            {loading ? (
              <div className="space-y-1 px-4 pt-1 pb-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : openTrades.length === 0 ? (
              <Empty
                text="No open positions"
                subtext="Positions appear when an analyst places a paper trade during a run."
              />
            ) : (
              <div>
                {openTrades.map((t) => (
                  <DashboardTradeRow
                    key={t.id}
                    trade={t}
                    flash={flashIds.get(t.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="closed" className="mt-0">
            {closedTrades.length === 0 ? (
              <Empty
                text="No closed trades yet"
                subtext="Trades close when they hit a target, stop-loss, or manual exit."
              />
            ) : (
              <div>
                {closedTrades.map((t) => (
                  <DashboardTradeRow key={t.id} trade={t} />
                ))}
              </div>
            )}
          </TabsContent>
        </CardContent>
      </Card>
    </Tabs>
  );
}

// ─── DashboardClient ──────────────────────────────────────────────────────────

interface DashboardClientProps {
  data?: DashboardData;
  userId?: string;
}

export default function DashboardClient({ data, userId }: DashboardClientProps) {
  const [range, setRange] = useState<Range>('1M');
  const [chartView, setChartView] = useState<ChartView>('portfolio');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('dollar');
  const [showMode, setShowMode] = useState<ShowMode>('both');
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

  // Derive the active equity curve based on showMode
  const activeCurve = useMemo(() => {
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

  // Raw equity over the same range — used only as the % denominator (the
  // capital actually at work). The active curve is deposit-adjusted P&L, whose
  // first point is ~0 at inception; dividing by THAT would explode the %.
  const equityRange = useMemo(() => filterByRange(rawEquity, range), [rawEquity, range]);

  // ── Portfolio header values ─────────────────────────────────────────────────
  const totalValueStr = formatCurrency(portfolio.totalValue);

  // Range-aware P&L: delta over the selected range from the active (filtered)
  // curve. Because that curve is deposit-adjusted, the delta is pure trading
  // P&L — a deposit inside the window cancels out instead of showing as a gain.
  const rangePnl = portfolioData.length >= 2
    ? portfolioData[portfolioData.length - 1].value - portfolioData[0].value
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

  const activePortfolioData = displayMode === 'percent' ? portfolioPercentData : portfolioData;

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

            {/* Portfolio header — two labeled figures, mirroring a broker
                statement: "BALANCE" over total account equity, and
                "{RANGE} P&L" over the deposit-adjusted gain for the selected
                window. The P&L is net of deposits/withdrawals, so funding the
                account never reads as a gain. Both values are text-xl for
                equal visual weight; mobile stacks them, desktop sits them
                side by side. */}
            <div className="space-y-0.5">
              {loading ? (
                <Skeleton className="h-12 w-80" />
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-8">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
                      Balance
                    </span>
                    <span className="text-xl font-semibold tabular-nums">
                      {totalValueStr}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
                      {RANGE_PNL_LABEL[range]}
                    </span>
                    <PriceChange
                      dollarChange={rangePnl}
                      percentChange={rangePnlPct}
                      size="xl"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Chart card */}
            <div
              className="rounded-lg overflow-hidden border"
              style={{
                backgroundImage:
                  'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
                backgroundSize: '18px 18px',
                backgroundColor: 'hsl(var(--muted)/0.3)',
              }}
            >
              {/* Controls: range tabs (left) + settings dropdown (right) */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 gap-2">
                {/* Range tabs */}
                <div className="flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border px-1 py-0.5">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={cn(
                        'px-2 py-0.5 text-xs rounded transition-colors',
                        range === r
                          ? 'bg-muted text-foreground font-medium'
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
                              <DropdownMenuRadioItem value="both">Total (Realized + Unrealized)</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="realized">Realized Only</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="unrealized">Unrealized Only</DropdownMenuRadioItem>
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
                      margin={{ top: 4, right: 0, bottom: 0, left: displayMode === 'percent' ? 4 : 0 }}
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
                      {displayMode === 'percent' ? (
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
                          displayMode === 'dollar'
                            ? `$${Number(v).toLocaleString()}`
                            : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`,
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

            {/* ── Portfolio stats grid (below the chart) ─────────────────
                4 tiles. Values reconcile against the top-of-page total:
                  cash + netPositionValue = totalValue (accounting identity)
                …so user can add tile 1 + tile 2 and get the big number.
                Responsive: mobile = 1-col stacked rows (label left,
                value right-aligned); desktop = 4-col grid with value
                above label.
                - Available Cash = raw Alpaca cash. Negative on margin.
                  Only the negative case shows a '-' prefix; positive shows
                  no '+' — a bare dollar amount reads as normal.
                - Position Value = long MV + signed-short MV — net worth of
                  open positions. Info tooltip explains it + surfaces
                  position count (moved out of the tile body on user ask,
                  who found it confusing inline).
                - Unrealized Gain = derived from Alpaca equity, not DB
                  per-position sums (which undercount when a live-price
                  fetch silently misses a ticker).
                - Success Rate = win rate across closed positions. */}
            {!loading && (
              <UITooltipProvider>
                {/* -mt-3 pulls the grid up toward the chart — user wanted
                    the two visually adjacent, not separated by the parent's
                    space-y-5 gap. gap-0 on mobile stacks tile rows flush;
                    sm:gap-4 gives the 4-col desktop tiles breathing room. */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-0 sm:gap-4 -mt-3 sm:mt-0">
                  <StatTile
                    label="Available Cash"
                    value={fmtTileCash(portfolio.cash)}
                    valueClassName={portfolio.cash < 0 ? 'text-negative' : undefined}
                    info={portfolio.usingMargin ? (
                      <InfoPopover>
                        Negative because the account is borrowing from the
                        margin line. You still have buying power; this is
                        the literal Alpaca cash field.
                      </InfoPopover>
                    ) : undefined}
                  />
                  <StatTile
                    label="Position Value"
                    value={fmtTileCurrency(portfolio.netPositionValue)}
                    info={
                      <InfoPopover>
                        Total market value of your open positions (long
                        minus short). Combined with Available Cash, this
                        equals the account total above.
                        {portfolio.openCount > 0 && (
                          <>
                            <br />
                            {portfolio.openCount} open position
                            {portfolio.openCount === 1 ? '' : 's'}.
                          </>
                        )}
                      </InfoPopover>
                    }
                  />
                  <StatTile
                    label="Unrealized Gain"
                    value={fmtTileSigned(portfolio.unrealizedPnl)}
                    valueClassName={portfolio.unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}
                  />
                  <StatTile
                    label="Success Rate"
                    value={portfolio.winRate != null ? `${Math.round(portfolio.winRate * 100)}%` : '—'}
                    info={portfolio.winRate == null ? (
                      <InfoPopover>No closed trades yet.</InfoPopover>
                    ) : undefined}
                  />
                </div>
              </UITooltipProvider>
            )}

            {/* Positions — mobile only. The desktop right rail is hidden
                below lg, so render the trade list inline here (chart → stats →
                trades → activity) so it's reachable on a phone. */}
            <div className="lg:hidden">
              <PositionsPanel
                openTrades={openTrades}
                closedTrades={closedTrades}
                loading={loading}
                flashIds={flashIds}
              />
            </div>

            {/* Theses + Activity tabbed section */}
            <HomeBottomSection
              picks={recentPicks}
              activity={data?.activityFeed ?? []}
              loading={loading}
            />
          </div>

          {/* ══ RIGHT column — positions (desktop only) ════════════════════ */}
          <div className="hidden lg:block w-80 shrink-0">
            <PositionsPanel
              openTrades={openTrades}
              closedTrades={closedTrades}
              loading={loading}
              flashIds={flashIds}
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
