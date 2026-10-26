import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { ThesisHeader } from '@/components/domain/thesis-header';
import { ThesisPageBody } from '@/components/trades/ThesisPageBody';
import { PnlBadge } from '@/components/ui/pnl-badge';
import { PriceChange } from '@/components/ui/price-change';
import { Badge } from '@/components/ui/badge';
import { getTradeStatusDisplay } from '@/lib/trade-status';
import { formatCurrency } from '@/lib/format';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
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
import { agentWatchDays } from '@/lib/agent/triggers/agent-watch';
import { canonicalLevels } from '@/lib/agent/triggers/price-levels';
import { getThesisComposite } from '@/lib/agent/thesis-narrative';
import {
  getStockProfile,
  getStockQuote,
} from '@/lib/actions/finnhub.actions';
import { getStockInfo } from '@/lib/actions/stock-info';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';
import { TradeActions } from '@/components/trades/TradeActions';

// ─── Helpers ────────────────────────────────────────────────────────────────

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
              conviction: true,
              convictionRationale: true,
              holdDuration: true,
              createdAt: true,
              researchRunId: true,
              researchRun: { select: { id: true, agentConfigId: true } },
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
  const hasFilledBuy = orders.some((o) => o.side === 'BUY' && o.status === 'FILLED');
  const openingBuy = orders.find((o) => o.side === 'BUY');
  const closingSell = orders.filter((o) => o.side === 'SELL').slice(-1)[0];

  // identity (StockInfo cache), stockProfile (sidebar info card: industry /
  // country / weburl), stockQuote and candles are independent — parallel.
  // The HEADER reads identity so the name + normalized exchange match the
  // thesis sheet exactly (same cache, same normalizer).
  const [identity, stockProfile, stockQuote] = await Promise.all([
    getStockInfo(position.symbol),
    getStockProfile(position.symbol),
    getStockQuote(position.symbol),
  ]);

  const trade = {
    ...position,
    ticker: position.symbol,
    entryPrice: position.avgCost,
    shares: position.quantity,
    thesis: position.decisions[0]?.thesis ?? null,
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

  // Days held: to the sale once closed, to today while open.
  const daysHeld = position.closedAt
    ? Math.max(1, Math.round((new Date(position.closedAt).getTime() - new Date(position.openedAt).getTime()) / 86_400_000))
    : isOpen && hasFilledBuy
      ? Math.max(0, Math.round((Date.now() - new Date(position.openedAt).getTime()) / 86_400_000))
      : null;
  // What the shares are worth now, for the summary's second line while open.
  const marketValue = isOpen ? currentPrice * position.quantity : null;

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

  // Shared formatter so the trade page + thesis sheet render currency
  // identically (formatCurrency enforces 2-decimal min+max).
  const fmtCur = (n: number | null | undefined) =>
    n != null ? formatCurrency(n) : '—';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* ── Header — the thesis's, the same one the sheet renders ─────── */}
      <div className="mb-6">
        <ThesisHeader
          ticker={trade.ticker}
          displayName={companyName ?? trade.ticker}
          exchange={exchange}
          status={trade.thesis?.status ?? (isClosed ? 'RETIRED' : 'HOLDING')}
          agentWatchDays={agentWatchDays(trade.thesis?.triggers)}
          conviction={(trade.thesis?.conviction ?? null) as 'STRONG' | 'HIGH' | 'MEDIUM' | 'LOW' | null}
          convictionRationale={trade.thesis?.convictionRationale ?? null}
          analystId={analystIdVal}
          thesisId={trade.thesis?.id}
          extraActions={<TradeActions tradeId={trade.id} ticker={trade.ticker} isOpen={isOpen} runId={runId} />}
        />
      </div>

      {/* The body carries the right-hand cards beside its tab panels, so they
          start level with the chart. */}
      <ThesisPageBody
        thesisId={trade.thesis?.id ?? null}
        ticker={trade.ticker}
        aside={
          <>
          {/* ── Position summary: the result once closed, the live position
              while held. The same card style as Trade Details below; the
              number is the header's PriceChange, the status is the app's pill. ── */}
          {(isClosed || (isOpen && hasFilledBuy)) && (() => {
            const summaryStatus = getTradeStatusDisplay(
              isOpen ? 'OPEN' : position.outcome === 'WIN' ? 'CLOSED_WIN' : position.outcome === 'LOSS' ? 'CLOSED_LOSS' : 'CLOSED_EXPIRED',
            );
            return (
              <Card>
                <CardContent className="p-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between pb-1">
                    <Badge variant="secondary" className="gap-1.5 font-normal">
                      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', summaryStatus.dotClass)} />
                      {summaryStatus.label}
                    </Badge>
                    {daysHeld != null && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {daysHeld} day{daysHeld !== 1 ? 's' : ''} held
                      </span>
                    )}
                  </div>
                  <div className="pb-2">
                    <PriceChange dollarChange={pnl} percentChange={pnlPct} size="xl" />
                  </div>
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
                  {isOpen && marketValue != null && (
                    <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                      <span className="text-muted-foreground">Now @ {fmtCur(currentPrice)}</span>
                      <span className="font-medium tabular-nums">{fmtCur(marketValue)}</span>
                    </div>
                  )}
                  {fmtExitReason(position.closeReason) && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Exit</span>
                      <span className="font-medium">{fmtExitReason(position.closeReason)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

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
          </>
        }
      />
    </div>
  );
}
