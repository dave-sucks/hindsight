import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { StockIdentityHeader } from '@/components/domain/stock-identity-header';
import { PinButton } from '@/components/stocks/PinButton';
import { PnlBadge } from '@/components/ui/pnl-badge';
import { PriceChange } from '@/components/ui/price-change';
import { buildTradeSentence } from '@/lib/trade-statement';
import { TradeStatement } from '@/components/ui/trade-statement';
import { formatCurrency } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { ThesisChart } from '@/components/domain/thesis-chart';
import { StockThesesList } from '@/components/stocks/StockThesesList';
import type { ThesisRowData } from '@/components/ui/thesis-row';
import { PriceTargetsBlock } from '@/components/domain/price-targets-block';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { getAccountId } from '@/lib/auth/account';
import { holdDurationFromHorizon } from '@/lib/agent/horizon-policy';
import {
  thesisSheetStateSelect,
} from '@/lib/agent/thesis-sheet-state';
import {
  loadLevelSources,
  resolveThesisLadder,
} from '@/lib/agent/triggers/load-levels';
import { canonicalLevels } from '@/lib/agent/triggers/price-levels';
import {
  getThesisBearCaseBullets,
  getThesisBullCaseBullets,
  getThesisComposite,
  getThesisSnapshotText,
} from '@/lib/agent/thesis-narrative';
import {
  getStockProfile,
  getStockQuote,
  getStockCandles,
} from '@/lib/actions/finnhub.actions';
import { getStockInfo } from '@/lib/actions/stock-info';
import { getPositionActivity, type ActivityEvent } from '@/lib/actions/activity';
import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  ArrowDownUp,
  Brain,
  ExternalLink,
  Target,
  Bot,
  Clock,
  User,
  TrendingDown,
  TrendingUp,
  Pencil,
  Info,
} from 'lucide-react';
import { TradeActions } from '@/components/trades/TradeActions';
import { ProposalActions } from '@/components/proposals/ProposalActions';
import { getTradeStatusDisplay } from '@/lib/trade-status';

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
  // PENDING_APPROVAL is a real state, not a terminal one. Without this
  // branch it fell through to the `return { label: 'Closed' }` at the
  // bottom and every `!isOpen` gate below rendered the closed-trade UI.
  if (positionStatus === 'PENDING_APPROVAL') {
    return {
      // Word comes from the canonical map — see the naming note in lib/trade-status.
      label: getTradeStatusDisplay('PENDING').label,
      dotClass: 'bg-amber-500 animate-pulse',
      tooltip: 'The agent proposed this trade. Nothing has been sent to Alpaca — approve it to place the order.',
    };
  }
  if (positionStatus === 'OPEN') {
    if (!hasFilledBuy && hasPendingOrder) {
      return {
        label: 'Awaiting fill',
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
      dotClass: 'bg-blue-500 animate-pulse',
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


function fmtExitReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
  const accountId = user ? await getAccountId(user.id) : null;

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
            select: {
              // P2-19: forward full state to the sheet — thesisSheetStateSelect
              // includes the V2 flat-schema narrative columns (snapshot /
              // bullCase / bearCase + 6 new sections).
              ...thesisSheetStateSelect,
              holdDuration: true,
              createdAt: true,
              researchRunId: true,
              researchRun: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (!position || !accountId || position.accountId !== accountId) notFound();

  const orders = position.orders;
  // The unapproved buy proposal, if this position is still awaiting a
  // decision. Its Order sits at AWAITING_APPROVAL — NOT 'PENDING', which is
  // "submitted to Alpaca, not yet filled". Conflating the two is what made
  // `hasPendingOrder` miss proposals entirely.
  const proposalOrder = orders.find((o) => o.status === 'AWAITING_APPROVAL') ?? null;
  const hasPendingOrder = orders.some((o) => o.status === 'PENDING');
  const hasFilledBuy = orders.some((o) => o.side === 'BUY' && o.status === 'FILLED');
  const openingBuy = orders.find((o) => o.side === 'BUY');
  const closingSell = orders.filter((o) => o.side === 'SELL').slice(-1)[0];

  // identity (StockInfo cache), stockProfile (sidebar info card: industry /
  // country / weburl), stockQuote and candles are independent — parallel.
  // The HEADER reads identity so the name + normalized exchange match the
  // thesis sheet exactly (same cache, same normalizer).
  const [identity, stockProfile, stockQuote, candles, activity] = await Promise.all([
    getStockInfo(position.symbol),
    getStockProfile(position.symbol),
    getStockQuote(position.symbol),
    getStockCandles(position.symbol, 365),
    // Unified activity read-layer (Order fills + level changes + thesis mint) —
    // replaces reading managementActions directly. See lib/actions/activity.ts.
    getPositionActivity(position.id),
  ]);

  const trade = {
    ...position,
    ticker: position.symbol,
    entryPrice: position.avgCost,
    shares: position.quantity,
    thesis: position.decisions[0]?.thesis ?? null,
    events: position.events,
  };

  const companyName = identity.companyName;
  const exchange = identity.exchange;

  const isOpen = position.status === 'OPEN';
  // Three states, not two. `!isOpen` used to mean "closed", which swept
  // PENDING_APPROVAL into every closed-trade branch on the page.
  const isProposal = position.status === 'PENDING_APPROVAL';
  const isClosed = !isOpen && !isProposal;
  const livePrice = stockQuote?.c ?? null;
  const closePrice = position.closePrice; // actual fill price per share at close
  const currentPrice = !isClosed && livePrice ? livePrice : (closePrice ?? position.avgCost);

  // P&L. A proposal has no P&L of any kind — no shares were ever bought, so
  // realized is meaningless and unrealized is not yet real.
  const realizedPnl = position.realizedPnl ?? 0;
  const unrealizedDollars = isOpen
    ? position.direction === 'LONG'
      ? (currentPrice - position.avgCost) * position.quantity
      : (position.avgCost - currentPrice) * position.quantity
    : realizedPnl;
  const positionCost = position.avgCost * position.quantity;
  const exitProceeds = closePrice != null ? closePrice * position.quantity : null;
  const pnl = isOpen ? unrealizedDollars : realizedPnl;
  const pnlPct = positionCost > 0 ? (pnl / positionCost) * 100 : 0;
  const isPos = pnl >= 0;

  const daysHeld = position.closedAt
    ? Math.max(1, Math.round((new Date(position.closedAt).getTime() - new Date(position.openedAt).getTime()) / 86_400_000))
    : null;

  const status = getStatusDisplay(position.status, position.outcome ?? null, hasPendingOrder, hasFilledBuy);
  // The levels in force, read off the thesis's resolved trigger list. This
  // used to be `position.targetPrice ?? avgCost * 1.1` / `* 0.9` — a made-up
  // ±10% band rendered as though it were the plan whenever the columns were
  // null, which is most of the time. A level shown here now fires.
  // See docs/plans/LEVELS_AS_TRIGGERS.md.
  const levelSources = position.analystId
    ? (await loadLevelSources([position.analystId])).get(position.analystId)
    : undefined;
  const thesisLevels = position.decisions[0]?.thesis
    ? canonicalLevels({
        triggers: resolveThesisLadder(
          position.decisions[0].thesis,
          levelSources,
          `thesis=${position.decisions[0].thesis.id}`,
        ),
        direction: position.direction,
        status: position.decisions[0].thesis.status,
        avgCost: Number(position.avgCost),
        peakPrice:
          position.peakPrice != null ? Number(position.peakPrice) : null,
      })
    : null;
  const targetLevel = thesisLevels?.target ?? null;
  const floorLevel = thesisLevels?.floor ?? null;
  const targetPrice = targetLevel?.price ?? null;
  const stopPrice = floorLevel?.price ?? null;

  // R:R needs BOTH a target and a floor. It used to always produce a number
  // because both sides fell back to a fabricated ±10% band, so a position
  // with no plan at all still displayed a confident "2.00:1". Null now, and
  // the row renders "—" — no plan, no ratio.
  const totalMove =
    targetPrice != null
      ? Math.abs(
          position.direction === 'LONG'
            ? targetPrice - position.avgCost
            : position.avgCost - targetPrice,
        )
      : null;
  const riskMove =
    stopPrice != null
      ? Math.abs(
          position.direction === 'LONG'
            ? position.avgCost - stopPrice
            : stopPrice - position.avgCost,
        )
      : null;
  const riskReward =
    totalMove != null && riskMove != null && riskMove > 0
      ? totalMove / riskMove
      : null;

  const analystName = position.analyst?.name ?? null;
  const analystIdVal = position.analyst?.id ?? null;
  const runId = trade.thesis?.researchRun?.id ?? null;

  const evalEvent = position.events.find((e) => e.eventType === 'EVALUATED');

  // Shared formatter so the trade page + thesis sheet render currency
  // identically (formatCurrency enforces 2-decimal min+max).
  const fmtCur = (n: number | null | undefined) =>
    n != null ? formatCurrency(n) : '—';

  // Quote data for stats grid
  const changePct = stockQuote?.dp ?? null;
  const isQuoteUp = (changePct ?? 0) >= 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <StockIdentityHeader
          ticker={trade.ticker}
          displayName={companyName ?? trade.ticker}
          exchange={exchange}
          badges={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Badge variant="secondary" className="gap-1.5 font-normal cursor-default">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", status.dotClass)} />
                      {status.label}
                    </Badge>
                  }
                />
                <TooltipContent side="bottom">{status.tooltip}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          actions={
            <>
              <PinButton ticker={trade.ticker} />
              <TradeActions tradeId={trade.id} ticker={trade.ticker} isOpen={isOpen} runId={runId} />
            </>
          }
        />
      </div>

      {/* ── 2-col grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* ════ MAIN column ════ */}
        <div className="min-w-0">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">
                Activity
                {activity.length > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium tabular-nums">
                    {activity.length}
                  </span>
                )}
              </TabsTrigger>
              {isClosed && evalEvent && (
                <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
              )}
            </TabsList>

            {/* ── OVERVIEW ─────────────────────────────────────────── */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              {/* Live market price — always shows current stock price with
                  today's change. Mobile: price on own row, delta underneath
                  at text-base (one size down). sm+ collapses to single row. */}
              <div className="space-y-0.5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  <span className="text-xl font-semibold tabular-nums">
                    {fmtCur(livePrice ?? currentPrice)}
                  </span>
                  {stockQuote && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={
                          <span className="cursor-default">
                            <PriceChange
                              dollarChange={stockQuote.d}
                              percentChange={changePct ?? null}
                              size="xl"
                            />
                          </span>
                        } />
                        <TooltipContent side="bottom" className="text-xs">Today&apos;s market movement</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
                {isClosed && closePrice != null && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    current market price · trade exited at {fmtCur(closePrice)}
                  </p>
                )}
              </div>

              {/* Trade banner + chart — two SIBLING elements grouped in one
                  bordered wrapper. The banner is not part of the chart (it
                  always renders, even when there's no candle data and the
                  chart degrades to the gauge); the wrapper owns the border,
                  the chart is frameless. */}
              <div className="rounded-lg border overflow-hidden">
                <TooltipProvider>
                  {/* Shared TradeStatement row — same component the thesis sheet
                      uses. No label, so the sentence is the primary line. The
                      animated + tooltip'd status dot rides in via the `dot` slot. */}
                  <TradeStatement
                    className="px-4 py-2.5 border-b"
                    dot={
                      <span className="self-center">
                        <Tooltip>
                          <TooltipTrigger render={
                            isOpen || isProposal ? (
                              hasPendingOrder || isProposal ? (
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
                          <TooltipContent side="bottom" className="text-xs tabular-nums">
                            <div>
                              {isProposal ? 'Proposed' : 'Opened'} {fmtDateTime(position.openedAt)}
                            </div>
                            {openingBuy?.filledAt && <div>Buy filled {fmtDateTime(openingBuy.filledAt)}</div>}
                            {isProposal && <div className="text-amber-500">Awaiting your approval</div>}
                            {hasPendingOrder && <div className="text-amber-500">Has pending order</div>}
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    }
                    sentence={buildTradeSentence(
                      isProposal
                        ? {
                            kind: 'proposed-buy',
                            qty: proposalOrder?.quantity ?? trade.shares,
                            entry: trade.entryPrice,
                            buyVerb: position.direction === 'SHORT' ? 'Short' : 'Buy',
                          }
                        : isOpen
                          ? hasFilledBuy
                            ? {
                                kind: 'holding',
                                qty: trade.shares,
                                entry: trade.entryPrice,
                                current: livePrice ?? currentPrice,
                              }
                            : {
                                kind: 'proposed-buy',
                                qty: trade.shares,
                                entry: trade.entryPrice,
                              }
                          : {
                              kind: 'closed',
                              qty: trade.shares,
                              entry: trade.entryPrice,
                              closePrice,
                            },
                    )}
                    gain={isProposal ? null : { dollar: pnl, pct: pnlPct }}
                    right={
                      isProposal && proposalOrder ? (
                        <ProposalActions orderId={proposalOrder.id} align="end" />
                      ) : undefined
                    }
                  />
                </TooltipProvider>
                <ThesisChart
                  ticker={trade.ticker}
                  candles={candles}
                  direction={trade.direction === 'SHORT' ? 'SHORT' : 'LONG'}
                  entryPrice={null}
                  avgCost={trade.entryPrice}
                  targetPrice={targetPrice}
                  stopLoss={stopPrice}
                  current={livePrice ?? currentPrice}
                  addedAt={trade.thesis?.createdAt ? new Date(trade.thesis.createdAt).toISOString() : null}
                  enteredAt={new Date(position.openedAt).toISOString()}
                  soldAt={position.closedAt ? new Date(position.closedAt).toISOString() : null}
                  variant="full"
                  frameless
                />
              </div>

              {/* Trade Thesis */}
              {trade.thesis && (() => {
                const t = trade.thesis;
                const composite = getThesisComposite(t);
                const rowData: ThesisRowData = {
                  id: t.id,
                  ticker: trade.symbol,
                  direction: t.direction as string,
                  status: t.status as string,
                  confidenceScore: composite != null ? composite * 10 : 0,
                  reasoningSummary: getThesisSnapshotText(t),
                  thesisBullets: getThesisBullCaseBullets(t),
                  riskFlags: getThesisBearCaseBullets(t),
                  entryPrice: trade.entryPrice,
                  targetPrice: targetPrice,
                  stopLoss: stopPrice,
                  horizon: t.horizon,
                  createdAt: t.createdAt?.toISOString?.() ?? null,
                  analystName: null,
                  runId: t.researchRunId ?? null,
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

            {/* ── ACTIVITY ─────────────────────────────────────────── */}
            {/* One unified, tier-ranked feed from the activity read-layer:
                buys/sells/adds/trims (Order fills), target/stop changes
                (management actions), and the thesis mint for context. */}
            <TabsContent value="activity" className="mt-4 max-w-2xl">
              {activity.length === 0 ? (
                <div className="rounded-lg border px-4 py-10 flex flex-col items-center gap-2">
                  <p className="text-sm text-muted-foreground text-center">No activity recorded yet.</p>
                  <p className="text-xs text-muted-foreground/60 text-center max-w-xs">
                    Buys, sells, target updates, and stop moves will appear here with the agent&apos;s reasoning.
                  </p>
                </div>
              ) : (
                <div className="space-y-0">
                  {activity.map((event: ActivityEvent, i: number) => {
                    const isLast = i === activity.length - 1;
                    const sourceLabel = event.source === 'price_monitor' ? 'Price monitor' : event.source === 'user' ? 'You' : 'Agent';
                    const SourceIcon = event.source === 'price_monitor' ? Clock : event.source === 'user' ? User : Bot;
                    const ActionIcon =
                      event.kind === 'BUY' || event.kind === 'ADD' ? TrendingUp
                      : event.kind === 'SELL' ? CheckCircle2
                      : event.kind === 'TRIM' ? TrendingDown
                      : event.kind === 'LEVELS_CHANGED' ? Target
                      : event.kind === 'THESIS_MINTED' ? Brain
                      : Pencil;

                    return (
                      <div key={event.id} className="flex gap-3 pb-5 last:pb-0">
                        <div className="flex flex-col items-center">
                          <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0 text-muted-foreground">
                            <ActionIcon className="h-3.5 w-3.5" />
                          </div>
                          {!isLast && <div className="w-px flex-1 bg-border mt-1 min-h-[20px]" />}
                        </div>
                        <div className="pt-0.5 pb-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium tabular-nums">{event.summary}</span>
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <SourceIcon className="h-3 w-3" />
                              {sourceLabel}
                            </span>
                          </div>
                          {event.reason && (
                            <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">{event.reason}</p>
                          )}
                          <p className="text-[11px] font-mono text-muted-foreground/60 mt-1 tabular-nums">
                            {new Date(event.at).toLocaleString('en-US', {
                              month: 'short', day: 'numeric',
                              hour: 'numeric', minute: '2-digit', hour12: true,
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── EVALUATION ──────────────────────────────────────── */}
            {isClosed && evalEvent && (
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

          {/* ── Post-Sale Result (closed trades only) ── */}
          {isClosed && (
            <div className={cn(
              'rounded-lg border p-4 space-y-3',
              isPos ? 'border-positive/20 bg-positive/5' : 'border-negative/20 bg-negative/5',
            )}>
              <div className="flex items-center justify-between">
                <span className={cn(
                  'text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded-full',
                  isPos ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative',
                )}>
                  {position.outcome === 'WIN' ? 'Win' : position.outcome === 'LOSS' ? 'Loss' : 'Closed'}
                </span>
                {daysHeld != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {daysHeld} day{daysHeld !== 1 ? 's' : ''} held
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-2">
                <span className={cn('text-2xl font-bold tabular-nums', isPos ? 'text-positive' : 'text-negative')}>
                  {isPos ? '+' : ''}{fmtCur(realizedPnl)}
                </span>
                <span className={cn('text-sm tabular-nums', isPos ? 'text-positive' : 'text-negative')}>
                  {isPos ? '+' : ''}{Math.abs(pnlPct).toFixed(2)}%
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">Bought @ {fmtCur(trade.entryPrice)}</span>
                  <span className="font-medium tabular-nums">{fmtCur(positionCost)}</span>
                </div>
                {exitProceeds != null && closePrice != null && (
                  <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                    <span className="text-muted-foreground">Sold @ {fmtCur(closePrice)}</span>
                    <span className="font-medium tabular-nums">{fmtCur(exitProceeds)}</span>
                  </div>
                )}
                {fmtExitReason(position.closeReason) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Exit</span>
                    <span className="font-medium">{fmtExitReason(position.closeReason)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Trade Details (always shown) ── */}
          <Card>
            <CardContent className="p-3 flex flex-col gap-1">
              {/* Static field rows */}
              {([
                { label: 'Shares', value: String(trade.shares) },
                { label: 'Avg Entry', value: fmtCur(trade.entryPrice) },
                { label: 'Cost Basis', value: fmtCur(positionCost) },
                ...(() => {
                  const composite = trade.thesis ? getThesisComposite(trade.thesis) : null;
                  return composite != null
                    ? [{ label: 'Composite', value: `${composite}/10` }]
                    : [];
                })(),
                {
                  label: 'R:R Ratio',
                  value: riskReward != null ? `${riskReward.toFixed(2)}:1` : '—',
                },
              ] as Array<{ label: string; value: string }>).map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
                </div>
              ))}

              {/* Analyst row */}
              {analystName && (
                <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">Analyst</span>
                  {analystIdVal ? (
                    <Link href={`/analysts/${analystIdVal}`} className="font-medium text-primary hover:underline truncate max-w-[60%]">
                      {analystName}
                    </Link>
                  ) : (
                    <span className="font-medium truncate max-w-[60%]">{analystName}</span>
                  )}
                </div>
              )}

              {/* Opened row — a proposal hasn't opened anything yet. */}
              <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                <span className="text-muted-foreground">{isProposal ? 'Proposed' : 'Opened'}</span>
                <span className="font-medium tabular-nums">{fmtDateTime(position.openedAt)}</span>
              </div>

              {/* Expiry — proposals lapse after 24h, so the deadline belongs
                  next to the other timestamps. */}
              {isProposal && proposalOrder?.expiresAt && (
                <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">Expires</span>
                  <span className="font-medium tabular-nums text-amber-500">
                    {fmtDateTime(proposalOrder.expiresAt)}
                  </span>
                </div>
              )}

              {/* Buy filled row */}
              {openingBuy && (
                <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">Buy filled</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger render={
                        <span className={cn(
                          'font-medium tabular-nums cursor-default underline decoration-dotted decoration-muted-foreground/40 underline-offset-2',
                          (openingBuy.status === 'PENDING' || openingBuy.status === 'AWAITING_APPROVAL') && 'text-amber-500',
                        )}>
                          {openingBuy.filledAt
                            ? fmtDateTime(openingBuy.filledAt)
                            : openingBuy.status === 'AWAITING_APPROVAL'
                              ? 'Not ordered'
                              : 'Awaiting fill'}
                        </span>
                      } />
                      <TooltipContent side="left" className="text-xs max-w-xs">
                        <div>
                          {openingBuy.filledAt
                            ? `Filled ${fmtDateTime(openingBuy.filledAt)}`
                            : `${openingBuy.status === 'AWAITING_APPROVAL' ? 'Proposed' : 'Ordered'} ${fmtDateTime(openingBuy.createdAt)}`}
                        </div>
                        {openingBuy.status === 'AWAITING_APPROVAL' && <div className="text-amber-500">Awaiting your approval · nothing sent to Alpaca</div>}
                        {openingBuy.status === 'PENDING' && <div className="text-amber-500">Awaiting fill · reconciles every 5 min</div>}
                        {openingBuy.alpacaOrderId && <div className="opacity-60 font-mono text-[10px]">Alpaca {openingBuy.alpacaOrderId}</div>}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}

              {/* Sell filled row — always present, '—' if still open */}
              <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                <span className="text-muted-foreground">Sell filled</span>
                {closingSell ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger render={
                        <span className={cn(
                          'font-medium tabular-nums cursor-default underline decoration-dotted decoration-muted-foreground/40 underline-offset-2',
                          closingSell.status === 'PENDING' && 'text-amber-500',
                        )}>
                          {closingSell.filledAt ? fmtDateTime(closingSell.filledAt) : 'Awaiting fill'}
                        </span>
                      } />
                      <TooltipContent side="left" className="text-xs max-w-xs">
                        <div>{closingSell.filledAt ? `Filled ${fmtDateTime(closingSell.filledAt)}` : `Ordered ${fmtDateTime(closingSell.createdAt)}`}</div>
                        {closingSell.status === 'PENDING' && <div className="text-amber-500">Awaiting fill · reconciles every 5 min</div>}
                        {closingSell.alpacaOrderId && <div className="opacity-60 font-mono text-[10px]">Alpaca {closingSell.alpacaOrderId}</div>}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <span className="font-medium text-muted-foreground/40 tabular-nums">—</span>
                )}
              </div>

              {/* Direction + Hold Duration — bottom of card */}
              {/* Hold-duration label is now derived from horizon at render
                  time (PR-4) so the legacy `holdDuration` column can drop
                  in PR-5. Falls back to the legacy value for rows without
                  horizon (pre-V2). */}
              {(() => {
                const holdLabel = trade.thesis?.horizon
                  ? holdDurationFromHorizon(trade.thesis.horizon)
                  : trade.thesis?.holdDuration ?? null;
                return [
                  { label: 'Direction', value: position.direction },
                  ...(holdLabel
                    ? [{ label: 'Hold Duration', value: holdLabel }]
                    : []),
                ] as Array<{ label: string; value: string }>;
              })().map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium tabular-nums">{value}</span>
                </div>
              ))}

              {/* Unrealized P&L — open trades only */}
              {isOpen && (
                <div className="pt-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Unrealized P&L</span>
                    <span className={cn('font-medium tabular-nums', isPos ? 'text-positive' : 'text-negative')}>
                      {isPos ? '+' : ''}{fmtCur(pnl)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground">Return</span>
                    <PnlBadge value={pnlPct} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Price Targets — standalone, identical to the thesis sheet */}
          <PriceTargetsBlock
            entry={trade.entryPrice}
            target={targetLevel}
            stop={floorLevel}
            storedTarget={position.decisions[0]?.thesis?.targetPrice ?? null}
            storedStop={position.decisions[0]?.thesis?.stopLoss ?? null}
            current={currentPrice}
            direction={position.direction === 'SHORT' ? 'SHORT' : 'LONG'}
          />

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
