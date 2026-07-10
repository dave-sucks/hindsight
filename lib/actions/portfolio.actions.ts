"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccount, getFundingActivities, getLatestPrices, getLatestPricesWithMeta, getPortfolioHistory, type PriceLookup } from "@/lib/alpaca";
import {
  netContributedTotal,
  depositAdjustedPnlCurve,
  type FundingEvent,
} from "@/lib/portfolio/contributions";
import { resolveAlpacaCredentials, type AlpacaEnvironment } from "@/lib/actions/api-keys.actions";
import { getAccountId } from "@/lib/auth/account";
import type { MockTrade, TradeStatus } from "@/lib/mock-data/trades";
import { etTradingDayDate } from "@/lib/market-hours";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

// ─── Constants ────────────────────────────────────────────────────────────────

// Fallback baseline ONLY when real contributions can't be sourced — i.e. paper
// accounts (seeded at $100k, no real CSD/CSW transfers) or a live account whose
// activities fetch failed. Live accounts derive their cost basis from actual
// deposits/withdrawals (see `netContributed` below). $100k matches Alpaca's
// paper-account seed, so paper math is unchanged.
const STARTING_CAPITAL = 100_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioStats {
  /** Total account equity — what you'd have if everything closed and margin was paid. Alpaca `equity`. */
  totalValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  winRate: number | null; // 0–1 or null if no closed positions
  openCount: number;
  // ── Account-shape metrics (margin-aware, sourced from Alpaca) ─────────────
  // These answer "what do I have / what am I holding / what can I still
  // trade" in terms anyone can understand, regardless of whether the account
  // is on margin. Avoid showing raw "cash" on the dashboard — on margin
  // accounts cash can be negative (borrowed) which is confusing and not
  // actionable. Buying power is the useful "what can I deploy next" number.
  /**
   * Net position value — signed sum of long and short market values.
   * Math identity: `cash + netPositionValue = equity` (always, regardless
   * of margin state). This is the "Position Value" tile on the dashboard
   * because the user can verify the math adds up: cash + net = total.
   */
  netPositionValue: number;
  /** Gross position market value = long + |short|. Used for leverage calc, not shown directly. */
  positionMarketValue: number;
  /** Market value of long positions only. */
  longMarketValue: number;
  /** Market value of short positions (absolute — $13K short stored as 13000). */
  shortMarketValue: number;
  /**
   * Literal Alpaca cash. NEGATIVE means the account is borrowing from
   * the margin line. Surfaced raw so `cash + netPositionValue` reconciles
   * to total equity; UI can annotate the negative case as "using margin."
   */
  cash: number;
  /** What you can still trade — includes margin. From Alpaca `buying_power`. */
  buyingPower: number;
  /** True if the account is using borrowed capital (positionMarketValue > equity). */
  usingMargin: boolean;
  /** Gross leverage ratio = positionMarketValue / equity. 1.0 = unleveraged. */
  leverageRatio: number;
  /** Total P&L (realized + unrealized). Surfaced for convenience. */
  totalPnl: number;
  /** Total P&L as % of net contributed capital — "how the account itself has performed." */
  accountReturnPct: number;
  /**
   * Net contributed capital = Σ deposits − Σ withdrawals (the account's cost
   * basis). Live: sourced from Alpaca CSD/CSW activities. Paper / no-creds:
   * falls back to STARTING_CAPITAL. This is the denominator that keeps a cash
   * deposit from reading as a gain.
   */
  netContributed: number;
  /** Today's P&L: `equity − last_equity` minus any deposit posted today. */
  dayPnl: number;
  /** Today's P&L as % of the prior close. */
  dayPnlPct: number;
}

export interface AgentConfigSummary {
  id: string;
  name: string;
  enabled: boolean;
  scheduleTime: string;
  lastRunAt: string | null; // ISO string
  tradesPlaced: number;
}

export interface RecentRunSummary {
  id: string;
  agentName: string | null;
  startedAt: string; // ISO string
  completedAt: string | null;
  thesisCount: number;
  tradesPlaced: number;
  status: string;
}

export interface TodaysPick {
  id: string;
  ticker: string;
  direction: string | null;
  confidenceScore: number;
  signalTypes: string[];
}

export interface RecentPick {
  id: string;
  ticker: string;
  direction: string | null;
  /** Lifecycle status — drives the row's leading badge (Watching / Active / etc.). */
  status: string;
  confidenceScore: number;
  signalTypes: string[];
  reasoningSummary: string;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  createdAt: string; // ISO
  decision: string | null; // BUY | SELL | PASS | HOLD — actual action taken
  position: {
    id: string;
    status: string;
    tradeStatus: TradeStatus; // derived from order fill state
    avgCost: number;
    quantity: number | null;
    openedAt: string; // ISO
    filledAt: string | null;  // when order filled (null = still pending)
    placedAt: string | null;  // when order was placed
  } | null;
  currentPrice: number | null;
  companyName: string | null;
  analystName: string | null;
  analystId: string | null;
  runId: string;
  sourcesUsed: unknown;
}

export interface SpyBenchmark {
  '1W': number | null;
  '1M': number | null;
  '1Y': number | null;
}

/** A single item in the homepage activity timeline. */
export interface ActivityFeedItem {
  id: string;
  type: "OPENED" | "CLOSED" | "MODIFIED" | "PROPOSED" | "REJECTED";
  positionId: string;
  symbol: string;
  direction: string | null;
  timestamp: string;   // ISO — used for sort/display
  label: string;       // e.g. "Opened LONG", "Closed — WIN", "Stop → breakeven"
  source: string;      // "agent" | "price_monitor" | "user"
  reason: string | null;
  pnl: number | null;
  pnlPct: number | null;
  outcome: string | null;
  analystName: string | null;
  // Trade-as-Proposal — populated on PROPOSED entries. orderId drives the
  // inline Review dropdown in ActivityRow. intent tells the row which
  // verb to show ("Buy" / "Add" / "Close" / "Trim").
  orderId?: string;
  intent?: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
  expiresAt?: string;
  // Share count + per-share entry price. On OPENED/PROPOSED rows `price` is
  // the entry; on CLOSED rows it's the avg cost, paired with `closePrice`
  // (the exit fill) so the feed can render the full shared trade sentence
  // "Bought N shares at $price, closed at $closePrice". Null on MODIFIED.
  shares?: number;
  price?: number;
  closePrice?: number;
}

export interface DashboardData {
  /** Held positions (Position.status === "OPEN"). Drives the "Open" count + all P&L / value math. */
  openTrades: MockTrade[];
  /**
   * Not-yet-approved buy proposals (Position.status === "PENDING_APPROVAL").
   * Rendered as a distinct "Pending approval" group — never counted as a
   * holding and never included in position-value totals (a proposal was never
   * sent to Alpaca).
   */
  pendingTrades: MockTrade[];
  closedTrades: MockTrade[];
  activityFeed: ActivityFeedItem[];
  portfolio: PortfolioStats;
  /** Total equity curve from Alpaca Portfolio History API (realized + unrealized). Falls back to realizedCurve. */
  equityCurve: { date: string; value: number }[];
  /**
   * Deposit-adjusted cumulative P&L curve: `equity − cumulative net
   * contributions` at each date. Flat across deposits (no cliff), so the
   * homepage header delta over any range is pure trading P&L. Equals the
   * equity curve when there are no funding events (paper).
   */
  pnlCurve: { date: string; value: number }[];
  /** Realized-only equity curve (cumulative closed P&L + starting capital). */
  realizedCurve: { date: string; value: number }[];
  agentConfigs: AgentConfigSummary[];
  recentRuns: RecentRunSummary[];
  todaysPicks: TodaysPick[];
  recentPicks: RecentPick[];
  hasAlpacaKey: boolean;
  analystCount: number;
  hasCompletedRun: boolean;
  hasBrief: boolean;
  analysts: { id: string; name: string }[];
  analystEquityCurves: Record<string, { date: string; value: number }[]>;
  spyBenchmark: SpyBenchmark;
  spyCandles: { date: string; close: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Closed-position display key from the real Position.status + outcome. The
// position query feeding closedTrades is `status IN (CLOSED, CANCELLED)`, so
// CANCELLED maps straight through; CLOSED splits into win/loss/breakeven from
// the real `outcome` field — no fictional combined status, just the trivial
// (status, outcome) → display-key map that TradeRow's dot/label needs.
const closedTradeStatus = (status: string, outcome: string | null): TradeStatus => {
  if (status === "CANCELLED") return "CANCELLED";
  if (outcome === "WIN") return "CLOSED_WIN";
  if (outcome === "LOSS") return "CLOSED_LOSS";
  return "CLOSED_EXPIRED";
};

function calcPnl(
  direction: string,
  entryPrice: number,
  currentPrice: number,
  shares: number
): { dollars: number; pct: number } {
  const dollars =
    direction === "LONG"
      ? (currentPrice - entryPrice) * shares
      : (entryPrice - currentPrice) * shares;
  const pct =
    direction === "LONG"
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;
  return { dollars, pct };
}

function buildEquityCurve(
  closedPositions: Array<{ closedAt: Date | null; realizedPnl: number | null }>,
  startCapital: number,
  currentTotalValue: number,
  days = 365
): { date: string; value: number }[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byDay = new Map<string, number>();
  for (const pos of closedPositions) {
    if (!pos.closedAt || !pos.realizedPnl) continue;
    if (pos.closedAt < cutoff) continue;
    const day = pos.closedAt.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + pos.realizedPnl);
  }

  let balance = startCapital;
  const points: { date: string; value: number }[] = [];

  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const iso = date.toISOString().slice(0, 10);
    balance += byDay.get(iso) ?? 0;
    points.push({ date: iso, value: balance });
  }

  if (points.length > 0) {
    points[points.length - 1] = {
      ...points[points.length - 1],
      value: currentTotalValue,
    };
  }

  return points;
}

// ─── Main data loader ─────────────────────────────────────────────────────────

export async function getDashboardData(
  environment: AlpacaEnvironment = "PAPER",
): Promise<DashboardData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const emptyPortfolio: PortfolioStats = {
    totalValue: STARTING_CAPITAL,
    unrealizedPnl: 0,
    realizedPnl: 0,
    winRate: null,
    openCount: 0,
    netPositionValue: 0,
    positionMarketValue: 0,
    longMarketValue: 0,
    shortMarketValue: 0,
    cash: STARTING_CAPITAL,
    buyingPower: STARTING_CAPITAL,
    usingMargin: false,
    leverageRatio: 1,
    totalPnl: 0,
    accountReturnPct: 0,
    netContributed: STARTING_CAPITAL,
    dayPnl: 0,
    dayPnlPct: 0,
  };

  if (!user) {
    return {
      openTrades: [],
      pendingTrades: [],
      closedTrades: [],
      activityFeed: [],
      portfolio: emptyPortfolio,
      equityCurve: [],
      pnlCurve: [],
      realizedCurve: [],
      agentConfigs: [],
      recentRuns: [],
      todaysPicks: [],
      recentPicks: [],
      hasAlpacaKey: false,
      analystCount: 0,
      hasCompletedRun: false,
      hasBrief: false,
      analysts: [],
      analystEquityCurves: {},
      spyBenchmark: { '1W': null, '1M': null, '1Y': null },
      spyCandles: [],
    };
  }

  const userId = user.id;
  const accountId = await getAccountId(userId);
  const todayMidnight = etTradingDayDate();

  if (!accountId) {
    // No membership — broken signup state. Return empty rather than
    // leaking another account's data via a defaulted scope.
    return {
      openTrades: [],
      pendingTrades: [],
      closedTrades: [],
      activityFeed: [],
      portfolio: emptyPortfolio,
      equityCurve: [],
      pnlCurve: [],
      realizedCurve: [],
      agentConfigs: [],
      recentRuns: [],
      todaysPicks: [],
      recentPicks: [],
      hasAlpacaKey: false,
      analystCount: 0,
      hasCompletedRun: false,
      hasBrief: false,
      analysts: [],
      analystEquityCurves: {},
      spyBenchmark: { '1W': null, '1M': null, '1Y': null },
      spyCandles: [],
    };
  }

  // ── Phase A: every DB read that doesn't depend on another result ─────────
  // Previously these were 7 sequential awaits stretched across the function;
  // collapsing them into one Promise.all turns a ~500ms waterfall into a
  // single round trip bounded by the slowest query.
  const [
    alpacaCreds,
    dbOpenPositions,
    dbClosedPositions,
    dbRecentPicks,
    dbAgentConfigs,
    positionsWithAnalyst,
    dbRecentRuns,
    dbTodaysPicks,
    dbManagementActions,
  ] = await Promise.all([
    resolveAlpacaCredentials(userId, environment).then((c) => c ?? undefined),
    prisma.position.findMany({
      // Trade-as-Proposal — include PENDING_APPROVAL positions so buy
      // proposals can render with their inline [Approve][Reject] buttons.
      // They're split into a separate `pendingTrades` bucket downstream so a
      // proposal never reads as a holding (see the partition below). CLOSED
      // positions stay filtered (they live on the Closed tab); CANCELLED is
      // the terminal state for rejected/expired proposals and doesn't belong here.
      where: {
        accountId,
        status: { in: ["OPEN", "PENDING_APPROVAL"] },
        environment,
      },
      include: {
        analyst: { select: { name: true } },
        // Pull recent orders — first the most-recent NON-awaiting order
        // (drives existing fill-state UI), then any AWAITING_APPROVAL
        // (drives the proposal [Approve][Reject] state). Fetching both
        // in one include via take=5 + status-agnostic ordering, mapped
        // below. The take is generous because a position can have multiple
        // historical orders (open + closes + adds); we just need to find
        // the latest fill state and any pending proposal.
        orders: {
          where: { side: { in: ["BUY", "SELL"] } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            side: true,
            status: true,
            filledAt: true,
            filledPrice: true,
            createdAt: true,
            alpacaOrderId: true,
            quantity: true,
            intent: true,
            expiresAt: true,
          },
        },
        decisions: {
          take: 1,
          select: { thesis: { select: { id: true } } },
        },
      },
      orderBy: { openedAt: "desc" },
    }).catch(() => [] as never[]),
    prisma.position.findMany({
      where: { accountId, status: { in: ["CLOSED", "CANCELLED"] }, environment },
      include: {
        analyst: { select: { name: true } },
        decisions: {
          take: 1,
          select: { thesis: { select: { id: true } } },
        },
      },
      orderBy: { closedAt: "desc" },
      take: 50,
    }).catch(() => [] as never[]),
    prisma.thesis.findMany({
      where: {
        accountId,
        updatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        researchRun: { environment },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        ticker: true,
        researchRunId: true,
        direction: true,
        status: true,
        // PR-9: dropped confidenceScore (Int) + signalTypes / sourcesUsed
        // (String[] / Json). Conviction lives in scoring.composite;
        // narrative lives in snapshot.
        scoring: true,
        snapshot: true,
        entryPrice: true,
        targetPrice: true,
        stopLoss: true,
        createdAt: true,
        researchRun: {
          select: { agentConfig: { select: { id: true, name: true } } },
        },
        // Pull the *opening* decision (INITIATE) so the position fields shown
        // on the thesis card always reflect the original entry, not a later
        // HOLD/EVALUATE decision that may have a null position link.
        decisions: {
          where: { decision: "INITIATE" },
          take: 1,
          orderBy: { createdAt: "asc" as const },
          select: {
            decision: true,
            position: {
              select: {
                id: true,
                status: true,
                avgCost: true,
                quantity: true,
                openedAt: true,
                orders: {
                  where: { side: { in: ["BUY", "SELL"] } },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { status: true, filledAt: true, createdAt: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.agentConfig.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      // select only what AgentConfigSummary needs — skip the big JSON/string
      // columns (analystPrompt, strategyInstructions, tickerUniverse, etc).
      select: {
        id: true,
        name: true,
        enabled: true,
        scheduleTime: true,
        researchRuns: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { startedAt: true },
        },
      },
    }),
    prisma.position.findMany({
      where: { accountId, environment },
      select: { id: true, analystId: true },
    }),
    prisma.researchRun.findMany({
      where: { accountId, environment },
      orderBy: { startedAt: "desc" },
      take: 10,
      // select only what RecentRunSummary needs — skip the `parameters`
      // JSON blob (can be huge) and the rest of the run's scalars.
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        status: true,
        agentConfig: { select: { name: true } },
        theses: { select: { id: true } },
        decisions: {
          where: { decision: "BUY" },
          select: { id: true },
        },
      },
    }),
    prisma.thesis.findMany({
      where: {
        accountId,
        createdAt: { gte: todayMidnight },
        direction: { in: ["LONG", "SHORT"] },
        researchRun: { environment },
      },
      // PR-9: was orderBy confidenceScore desc — scoring.composite is
      // Json and not server-sortable. Order createdAt-desc and downstream
      // ranks by composite client-side.
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        ticker: true,
        direction: true,
        scoring: true,
      },
    }),
    // Activity feed: recent management actions with position context
    // .catch(() => []) — silently degrades if table hasn't been migrated yet
    prisma.positionManagementAction.findMany({
      where: { position: { accountId, environment } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        id: true,
        positionId: true,
        actionType: true,
        source: true,
        reason: true,
        fillPrice: true,
        fillQty: true,
        createdAt: true,
        position: {
          select: {
            symbol: true,
            direction: true,
            realizedPnl: true,
            avgCost: true,
            quantity: true,
            outcome: true,
            analyst: { select: { name: true } },
          },
        },
      },
    }).catch(() => [] as never[]),
  ]);

  // ── Phase B: price + name lookups + SPY benchmark, parallel ────────────
  // These depend on tickers from phase A but are independent of each other,
  // so run them in parallel instead of sequentially.
  const openTickers = [...new Set(dbOpenPositions.map((p) => p.symbol))];
  const pickTickers = [...new Set(dbRecentPicks.map((p) => p.ticker))];
  const allTickers = [...new Set([...openTickers, ...pickTickers])];

  const emptyPriceLookup: PriceLookup = {
    prices: {},
    sources: {},
    fetchedAt: new Date().toISOString(),
  };

  function computeSpyReturn(candles: { date: string; close: number }[], days: number): number | null {
    if (candles.length < 2) return null;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sliced = candles.filter((c) => new Date(c.date + 'T12:00:00') >= cutoff);
    if (sliced.length < 2) return null;
    const start = sliced[0].close;
    const end = sliced[sliced.length - 1].close;
    return ((end - start) / start) * 100;
  }

  const [priceLookup, nameMap, spyCandles, portfolioHistory, alpacaAccount, fundingEvents] = await Promise.all([
    allTickers.length > 0
      ? getLatestPricesWithMeta(allTickers, alpacaCreds).catch((err) => {
          console.error(
            `[portfolio] getLatestPricesWithMeta threw — ${err instanceof Error ? err.message : err}. Falling back to entry prices.`,
          );
          return emptyPriceLookup;
        })
      : Promise.resolve(emptyPriceLookup),
    (async () => {
      const map: Record<string, string> = {};
      try {
        const { getStockProfile } = await import("@/lib/actions/finnhub.actions");
        const profiles = await Promise.allSettled(
          pickTickers.map(async (t) => {
            const p = await getStockProfile(t);
            return { ticker: t, name: p?.name ?? null };
          }),
        );
        for (const r of profiles) {
          if (r.status === "fulfilled" && r.value.name) {
            map[r.value.ticker] = r.value.name;
          }
        }
      } catch {
        // Finnhub down — names will be null
      }
      return map;
    })(),
    (async () => {
      try {
        const { getStockCandles } = await import("@/lib/actions/finnhub.actions");
        const candles = await getStockCandles('SPY', 400);
        return candles.map((c) => ({ date: c.date, close: c.close }));
      } catch {
        return [] as { date: string; close: number }[];
      }
    })(),
    // Alpaca Portfolio History — total equity including unrealized P&L
    alpacaCreds
      ? getPortfolioHistory({}, alpacaCreds).catch((err) => {
          console.warn(`[portfolio] getPortfolioHistory failed: ${err instanceof Error ? err.message : err}`);
          return [] as import("@/lib/alpaca").PortfolioHistoryPoint[];
        })
      : Promise.resolve([] as import("@/lib/alpaca").PortfolioHistoryPoint[]),
    // Alpaca Account — live equity (source of truth for total portfolio value)
    alpacaCreds
      ? getAccount(alpacaCreds).catch((err) => {
          console.warn(`[portfolio] getAccount failed: ${err instanceof Error ? err.message : err}`);
          return null;
        })
      : Promise.resolve(null),
    // External cash flows (deposits/withdrawals) — used to strip funding out of
    // reported P&L so a deposit doesn't read as a gain. LIVE only: paper has no
    // real CSD/CSW transfers, so it keeps the STARTING_CAPITAL baseline.
    alpacaCreds && environment === "LIVE"
      ? getFundingActivities(alpacaCreds).catch((err) => {
          console.warn(`[portfolio] getFundingActivities failed: ${err instanceof Error ? err.message : err}`);
          return [] as FundingEvent[];
        })
      : Promise.resolve([] as FundingEvent[]),
  ]);
  const priceMap = priceLookup.prices;

  // Order reconciliation now runs centrally in the reconcile-orders Inngest
  // cron (every 5 min) and the sync-heartbeat (every 1 min during RTH). The
  // dashboard reads whatever they've persisted — no inline mutation here.
  const effectiveOpenPositions = dbOpenPositions;

  const spyBenchmark: SpyBenchmark = {
    '1W': computeSpyReturn(spyCandles, 7),
    '1M': computeSpyReturn(spyCandles, 30),
    '1Y': computeSpyReturn(spyCandles, 365),
  };

  // ── 4. Map open positions → MockTrade shape ────────────────────────────────
  // Held positions (status OPEN) and not-yet-approved buy proposals (status
  // PENDING_APPROVAL) come from the same query above (one round trip), but the
  // homepage must show them as two distinct things — a proposal is NOT a
  // holding. Build the view-model with one mapper, then partition by
  // Position.status: `openTrades` (held) feeds the "Open" count + every
  // P&L / value calc; `pendingTrades` (proposals) renders in its own "Pending
  // approval" group and never touches position-value totals (it was never sent
  // to Alpaca).
  const toOpenMockTrade = (p: (typeof effectiveOpenPositions)[number]): MockTrade => {
    const livePrice = priceMap[p.symbol];
    const priceSource = priceLookup.sources[p.symbol] ?? "missing";
    const currentPrice = livePrice ?? p.avgCost;
    const { dollars, pct } = calcPnl(p.direction, p.avgCost, currentPrice, p.quantity);

    // Pick the latest non-awaiting order for fill-state UI, and separately
    // the awaiting-approval order for the proposal state. Each position can
    // have multiple historical orders so we scan rather than indexing [0].
    // See docs/plans/TRADE_AS_PROPOSAL.md §6.
    const orders = p.orders ?? [];
    const awaitingOrder = orders.find((o) => o.status === "AWAITING_APPROVAL");
    const fillOrder = orders.find((o) => o.status !== "AWAITING_APPROVAL");

    // Derive the display status from Position.status + latest Order.status.
    // Position stays OPEN until its BUY actually fills; the PENDING/REJECTED
    // view-model statuses are UI-only denormalizations.
    // Just the position's own status, with one overlay: a genuinely in-flight
    // buy shows PENDING. A holding (OPEN) stays OPEN even if its last order was
    // a rejected close — reject means you kept the position. A not-yet-filled
    // buy proposal (PENDING_APPROVAL) reads PENDING, not blue. REJECTED / other
    // terminal orders are audit history, never a standing status (that was the
    // "Rejected" badge that used to stick to live holdings forever).
    let displayStatus: TradeStatus = p.status === "OPEN" ? "OPEN" : "PENDING";
    if (fillOrder?.status === "PENDING") displayStatus = "PENDING";

    // Trade-as-Proposal — surface the awaiting-approval order so TradeRow
    // renders the inline [Approve][Reject] in place of the P&L slot.
    const pendingProposal = awaitingOrder
      ? {
          orderId: awaitingOrder.id,
          intent: (awaitingOrder.intent ?? "OPEN") as
            | "OPEN"
            | "ADD"
            | "CLOSE"
            | "PARTIAL_CLOSE",
        }
      : undefined;

    return {
      id: p.id,
      ticker: p.symbol,
      direction: p.direction as "LONG" | "SHORT",
      entryPrice: p.avgCost,
      currentPrice,
      targetPrice: p.targetPrice ?? p.avgCost * 1.1,
      stopPrice: p.stopLoss ?? p.avgCost * 0.9,
      confidenceScore: 0, // TODO: join via TradeDecision → Thesis
      status: displayStatus,
      pnl: livePrice !== undefined ? dollars : 0,
      pnlPct: livePrice !== undefined ? pct : 0,
      openedAt: p.openedAt.toISOString(),
      closedAt: undefined,
      thesis: "",
      shares: p.quantity,
      analystName: p.analyst?.name ?? undefined,
      analystId: p.analystId ?? undefined,
      placedAt: fillOrder?.createdAt?.toISOString(),
      filledAt: fillOrder?.filledAt?.toISOString(),
      orderStatus: fillOrder?.status,
      alpacaOrderId: fillOrder?.alpacaOrderId ?? undefined,
      priceSource,
      priceUpdatedAt: livePrice !== undefined ? priceLookup.fetchedAt : undefined,
      pendingProposal,
      thesisId: p.decisions?.[0]?.thesis?.id ?? undefined,
    };
  };

  const heldPositions = effectiveOpenPositions.filter((p) => p.status === "OPEN");
  const openTrades: MockTrade[] = heldPositions.map(toOpenMockTrade);

  // Pending review = anything awaiting the user's approval, NOT just brand-new
  // buy proposals. A new buy is a Position in PENDING_APPROVAL; but a proposed
  // exit/trim/add on an already-held name is an OPEN position carrying an
  // AWAITING_APPROVAL order (intent CLOSE / PARTIAL_CLOSE / ADD). Both need the
  // same top-right review surface — keying only on PENDING_APPROVAL silently
  // dropped every exit/trim proposal, so those reviews surfaced only in the
  // buried Activity feed and were easy to miss. A held name awaiting an exit
  // still counts as held for P&L (it stays in `openTrades` above); this list is
  // purely the "needs your decision" surface, so it's fine for it to appear in
  // both places.
  const pendingProposalPositions = effectiveOpenPositions.filter(
    (p) =>
      p.status === "PENDING_APPROVAL" ||
      (p.orders ?? []).some((o) => o.status === "AWAITING_APPROVAL"),
  );
  const pendingTrades: MockTrade[] = pendingProposalPositions.map(toOpenMockTrade);

  // ── 5. Map closed positions → MockTrade shape ──────────────────────────────
  const closedTrades: MockTrade[] = dbClosedPositions.map((p) => {
    const closePrice = p.closePrice ?? p.avgCost;
    const positionCost = p.avgCost * p.quantity;
    const realizedPnl = p.realizedPnl ?? 0;
    return {
      id: p.id,
      ticker: p.symbol,
      direction: p.direction as "LONG" | "SHORT",
      entryPrice: p.avgCost,
      currentPrice: closePrice,
      targetPrice: p.targetPrice ?? p.avgCost * 1.1,
      stopPrice: p.stopLoss ?? p.avgCost * 0.9,
      confidenceScore: 0,
      status: closedTradeStatus(p.status, p.outcome),
      pnl: realizedPnl,
      pnlPct: positionCost > 0 ? (realizedPnl / positionCost) * 100 : 0,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt?.toISOString(),
      thesis: "",
      shares: p.quantity,
      analystName: p.analyst?.name ?? undefined,
      analystId: p.analystId ?? undefined,
      thesisId: p.decisions?.[0]?.thesis?.id ?? undefined,
    };
  });

  // ── 6. Portfolio stats ─────────────────────────────────────────────────────
  const realizedPnl = dbClosedPositions.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0);

  // Net contributed capital = the account's cost basis. LIVE: Σ deposits −
  // Σ withdrawals from Alpaca CSD/CSW activities. Paper / no-creds / failed
  // fetch: fall back to the STARTING_CAPITAL seed (paper math unchanged).
  // This is the number that stops a cash deposit from reading as a gain.
  const netContributed =
    fundingEvents.length > 0 ? netContributedTotal(fundingEvents) : STARTING_CAPITAL;

  // Alpaca's equity is always correct — it includes every open position's
  // live mark-to-market. Derive unrealized from the account identity:
  //   equity = net_contributed + realized + unrealized
  //   ⇒ unrealized = equity − net_contributed − realized
  // The old path summed openTrades[].pnl, but per-position pnl is 0 when
  // the live-price fetch silently misses a ticker — so a 10-position
  // portfolio where 3 prices didn't fetch would under-count by those 3.
  // Falls back to the DB-summed path only when Alpaca creds are absent.
  const totalValue = alpacaAccount
    ? parseFloat(alpacaAccount.equity)
    : netContributed + realizedPnl + openTrades.reduce((sum, t) => sum + t.pnl, 0);
  const unrealizedPnl = alpacaAccount
    ? totalValue - netContributed - realizedPnl
    : openTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;

  // Day's P&L — equity vs the prior trading day's close, minus any deposit
  // that posted today (so funding the account today isn't a "gain" either).
  const lastEquity = alpacaAccount?.last_equity ? parseFloat(alpacaAccount.last_equity) : null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const depositsToday = fundingEvents
    .filter((e) => e.date === todayIso)
    .reduce((sum, e) => sum + e.amount, 0);
  const dayPnl =
    lastEquity != null && Number.isFinite(lastEquity)
      ? totalValue - lastEquity - depositsToday
      : 0;
  const dayPnlPct =
    lastEquity != null && lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0;

  const closedWithOutcome = dbClosedPositions.filter((p) => p.outcome);
  const winRate =
    closedWithOutcome.length > 0
      ? closedWithOutcome.filter((p) => p.outcome === "WIN").length /
        closedWithOutcome.length
      : null;

  // ── 6b. Account-shape (margin-aware, Alpaca as source of truth) ───────────
  // Alpaca is always right about what's currently held, how much is
  // borrowed, and what's available to trade. The DB Position table can
  // drift — stale rows, sync gaps — so don't derive position market value
  // from Prisma for the dashboard. Fall back to a DB-only estimate only
  // when Alpaca creds are absent (onboarding, API failure).
  const longMarketValue = alpacaAccount?.long_market_value
    ? parseFloat(alpacaAccount.long_market_value)
    : 0;
  // Alpaca returns short_market_value as a NEGATIVE number. Store its
  // absolute value (so shortMarketValue = 13000 for a $13k short position)
  // — downstream callers that want the signed version compute it via
  // `netPositionValue` below, which retains the accounting-correct signs.
  const shortMarketValueRaw = alpacaAccount?.short_market_value
    ? parseFloat(alpacaAccount.short_market_value)
    : 0;
  const shortMarketValue = Math.abs(shortMarketValueRaw);
  const positionMarketValue = longMarketValue + shortMarketValue; // gross
  // Net position = long − shorts. Accounting identity: cash + netPositionValue
  // = equity. Used for the "Position Value" dashboard tile so the visible math
  // reconciles: Available Cash + Position Value = Total Account Value.
  const netPositionValue = longMarketValue + shortMarketValueRaw; // signed sum
  // DB-only fallback (no Alpaca creds): approximate cash as starting capital
  // + realized proceeds − capital currently tied up in open positions at
  // entry cost. Under-counts unrealized appreciation on open positions, but
  // at least reconciles directionally with totalValue. Held only — a pending
  // proposal hasn't spent any cash, so it must not reduce available cash.
  const dbOpenCostBasis = heldPositions.reduce(
    (s, p) => s + p.avgCost * p.quantity,
    0,
  );
  const cash = alpacaAccount
    ? parseFloat(alpacaAccount.cash)
    : netContributed + realizedPnl - dbOpenCostBasis;
  const buyingPower = alpacaAccount
    ? parseFloat(alpacaAccount.buying_power)
    : Math.max(0, totalValue);
  // Any time gross exposure exceeds equity, the account is using borrowed
  // capital. Surfacing this lets the UI badge the header + warn users who
  // aren't expecting margin semantics (negative cash, amplified P&L).
  const usingMargin = positionMarketValue > totalValue + 1; // $1 tolerance for float noise
  const leverageRatio = totalValue > 0 ? positionMarketValue / totalValue : 1;
  const accountReturnPct = netContributed > 0 ? (totalPnl / netContributed) * 100 : 0;

  // ── 7. Equity curves ───────────────────────────────────────────────────────
  // realizedCurve: cumulative closed P&L starting from net contributed capital
  const realizedCurve = buildEquityCurve(dbClosedPositions, netContributed, totalValue);

  // equityCurve: total equity from Alpaca Portfolio History API (includes unrealized)
  // Falls back to realizedCurve if Alpaca creds are missing or call failed.
  const equityCurve: { date: string; value: number }[] =
    portfolioHistory.length >= 2
      ? portfolioHistory.map((p) => ({ date: p.date, value: p.equity }))
      : realizedCurve;

  // pnlCurve: deposit-adjusted cumulative P&L (equity − cumulative net
  // contributions). Flat across deposits, so the homepage header delta over
  // any range is pure trading P&L. Equals equityCurve when there are no
  // funding events (paper / no transfers recorded).
  const pnlCurve: { date: string; value: number }[] =
    portfolioHistory.length >= 2
      ? depositAdjustedPnlCurve(
          portfolioHistory.map((p) => ({ date: p.date, equity: p.equity })),
          fundingEvents,
        )
      : equityCurve;

  // ── 7b. Per-analyst equity curves (cumulative P&L, starting from 0) ────────
  const analystEquityCurves: Record<string, { date: string; value: number }[]> = {};
  const analystsWithTrades = new Set<string>([
    ...dbClosedPositions.map((p) => p.analystId),
    ...dbOpenPositions.map((p) => p.analystId),
  ]);
  for (const analystId of analystsWithTrades) {
    const closedForAnalyst = dbClosedPositions.filter((p) => p.analystId === analystId);
    const analystOpenPnl = openTrades
      .filter((t) => t.analystId === analystId)
      .reduce((s, t) => s + t.pnl, 0);
    const analystRealizedPnl = closedForAnalyst.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
    analystEquityCurves[analystId] = buildEquityCurve(
      closedForAnalyst,
      0,
      analystRealizedPnl + analystOpenPnl,
      365,
    );
  }

  // ── 8. Agent configs with last-run info (fetched in phase A) ──────────
  const tradeCountMap = new Map<string, number>();
  for (const pos of positionsWithAnalyst) {
    tradeCountMap.set(pos.analystId, (tradeCountMap.get(pos.analystId) ?? 0) + 1);
  }

  const agentConfigs: AgentConfigSummary[] = dbAgentConfigs.map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    scheduleTime: a.scheduleTime,
    lastRunAt: a.researchRuns[0]?.startedAt.toISOString() ?? null,
    tradesPlaced: tradeCountMap.get(a.id) ?? 0,
  }));

  const analysts = dbAgentConfigs
    .filter((a) => analystsWithTrades.has(a.id))
    .map((a) => ({ id: a.id, name: a.name }));

  // ── 9. Recent research runs (fetched in phase A) ─────────────────────
  const recentRuns: RecentRunSummary[] = dbRecentRuns.map((r) => ({
    id: r.id,
    agentName: r.agentConfig?.name ?? null,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    thesisCount: r.theses.length,
    tradesPlaced: r.decisions.length,
    status: r.status,
  }));

  // ── 10. Today's picks (fetched in phase A) ───────────────────────────
  // PR-9: legacy 0-100 confidence → composite × 10; signalTypes dropped
  // (derivable from sourceSignalIds if needed).
  const todaysPicks: TodaysPick[] = dbTodaysPicks.map((t) => {
    const composite = getThesisComposite(t);
    return {
      id: t.id,
      ticker: t.ticker,
      direction: t.direction,
      confidenceScore: composite != null ? composite * 10 : 0,
      signalTypes: [],
    };
  });

  // ── 11. Map recentPicks ────────────────────────────────────────────────────
  const recentPicks: RecentPick[] = dbRecentPicks.map((p) => {
    const dec = p.decisions[0]; // INITIATE decision only (filtered in query)
    const rawPos = dec?.position ?? null;

    let positionData: RecentPick["position"] = null;
    if (rawPos) {
      const order = rawPos.orders?.[0];
      // Derive tradeStatus from order fill state — same logic as trade sidebar.
      // Position.status is always "OPEN" until closed; "PENDING" is UI-only.
      // Same as the trade sidebar: a holding is a holding. Use the POSITION
      // status for the cancelled (rejected-buy) case, not the order — a rejected
      // close leaves the position OPEN, and only a genuinely in-flight buy shows
      // PENDING. (Was: any rejected order pinned this row to "Rejected" forever.)
      let tradeStatus: TradeStatus = "OPEN";
      if (rawPos.status === "CANCELLED") tradeStatus = "CANCELLED";
      else if (order?.status === "PENDING") tradeStatus = "PENDING";

      positionData = {
        id: rawPos.id,
        status: rawPos.status,
        tradeStatus,
        avgCost: rawPos.avgCost,
        quantity: rawPos.quantity ?? null,
        openedAt: rawPos.openedAt.toISOString(),
        filledAt: order?.filledAt ? new Date(order.filledAt).toISOString() : null,
        placedAt: order?.createdAt ? new Date(order.createdAt).toISOString() : null,
      };
    }

    // PR-9: legacy 0-100 confidence → composite × 10; signalTypes /
    // sourcesUsed dropped; reasoningSummary sourced from snapshot.
    const composite = getThesisComposite(p);
    return {
      id: p.id,
      ticker: p.ticker,
      direction: p.direction,
      status: p.status,
      confidenceScore: composite != null ? composite * 10 : 0,
      signalTypes: [],
      reasoningSummary: getThesisSnapshotText(p),
      entryPrice: p.entryPrice,
      targetPrice: p.targetPrice,
      stopLoss: p.stopLoss,
      createdAt: p.createdAt.toISOString(),
      decision: dec?.decision ?? null,
      position: positionData,
      currentPrice: priceMap[p.ticker] ?? null,
      companyName: nameMap[p.ticker] ?? null,
      analystName: p.researchRun?.agentConfig?.name ?? null,
      analystId: p.researchRun?.agentConfig?.id ?? null,
      runId: p.researchRunId,
      sourcesUsed: [],
    };
  });

  // ── 12. Activity feed — merge trade opens/closes + management actions ──────
  const activityFeed: ActivityFeedItem[] = [];

  // Recent opens (last 20).
  // Trade-as-Proposal: positions in PENDING_APPROVAL aren't really opened
  // yet — emit a PROPOSED entry instead of OPENED so the row renders the
  // inline [Approve][Reject] action pair. Positions with an
  // AWAITING_APPROVAL close order are already-open positions and DO get the
  // regular OPENED entry above + a separate PROPOSED entry for the
  // pending close (emitted in the loop below).
  for (const p of dbOpenPositions.slice(0, 20)) {
    const awaitingOrder = p.orders?.find((o) => o.status === "AWAITING_APPROVAL");
    const isPendingApprovalBuy =
      p.status === "PENDING_APPROVAL" &&
      awaitingOrder?.intent === "OPEN";

    if (isPendingApprovalBuy) {
      activityFeed.push({
        id: `proposed-${awaitingOrder.id}`,
        type: "PROPOSED",
        positionId: p.id,
        symbol: p.symbol,
        direction: p.direction,
        timestamp: awaitingOrder.createdAt.toISOString(),
        label: `Proposed ${p.direction === "LONG" ? "buy" : "short"}`,
        source: "agent",
        reason: null,
        pnl: null,
        pnlPct: null,
        outcome: null,
        analystName: p.analyst?.name ?? null,
        orderId: awaitingOrder.id,
        intent: "OPEN",
        expiresAt: awaitingOrder.expiresAt?.toISOString(),
        shares: awaitingOrder.quantity ?? p.quantity,
        price: p.avgCost,
      });
      continue;
    }

    activityFeed.push({
      id: `open-${p.id}`,
      type: "OPENED",
      positionId: p.id,
      symbol: p.symbol,
      direction: p.direction,
      timestamp: p.openedAt.toISOString(),
      label: `Opened ${p.direction}`,
      source: "agent",
      reason: null,
      pnl: null,
      pnlPct: null,
      outcome: null,
      analystName: p.analyst?.name ?? null,
      shares: p.quantity,
      price: p.avgCost,
    });

    // For an OPEN position with a pending close/add/trim proposal, ALSO
    // emit a separate PROPOSED entry so the row surfaces in the feed.
    if (awaitingOrder && awaitingOrder.intent !== "OPEN") {
      const intent = (awaitingOrder.intent ?? "CLOSE") as
        | "ADD"
        | "CLOSE"
        | "PARTIAL_CLOSE";
      const verb =
        intent === "ADD" ? "add to" :
        intent === "CLOSE" ? "close" :
        "trim";
      activityFeed.push({
        id: `proposed-${awaitingOrder.id}`,
        type: "PROPOSED",
        positionId: p.id,
        symbol: p.symbol,
        direction: p.direction,
        timestamp: awaitingOrder.createdAt.toISOString(),
        label: `Proposed ${verb}`,
        source: "agent",
        reason: null,
        pnl: null,
        pnlPct: null,
        outcome: null,
        analystName: p.analyst?.name ?? null,
        orderId: awaitingOrder.id,
        intent,
        expiresAt: awaitingOrder.expiresAt?.toISOString(),
        shares: awaitingOrder.quantity ?? p.quantity,
        price: p.avgCost,
      });
    }
  }

  // Recent closes (last 20)
  for (const p of dbClosedPositions.slice(0, 20)) {
    // A CANCELLED position is a rejected/expired proposal that never filled —
    // surface it as REJECTED, not a CLOSED/"Sold" trade. (Rejected IONS/XENE buy
    // proposals were showing as "Sold" with $0 P&L.) It IS real activity, so we
    // keep it in the feed — just labeled honestly.
    if (p.status === "CANCELLED") {
      activityFeed.push({
        id: `reject-${p.id}`,
        type: "REJECTED",
        positionId: p.id,
        symbol: p.symbol,
        direction: p.direction,
        timestamp: (p.closedAt ?? p.updatedAt).toISOString(),
        label: `Rejected — buy ${p.quantity} @ $${p.avgCost.toFixed(2)}`,
        source: (p as { closeSource?: string | null }).closeSource ?? "user",
        reason: null,
        pnl: null,
        pnlPct: null,
        outcome: null,
        analystName: p.analyst?.name ?? null,
        shares: p.quantity,
        price: p.avgCost,
      });
      continue;
    }
    const pnl = p.realizedPnl ?? 0;
    const positionCost = p.avgCost * p.quantity;
    const pnlPct = positionCost > 0 ? (pnl / positionCost) * 100 : 0;
    const sign = pnl >= 0 ? "+" : "";
    activityFeed.push({
      id: `close-${p.id}`,
      type: "CLOSED",
      positionId: p.id,
      symbol: p.symbol,
      direction: p.direction,
      timestamp: (p.closedAt ?? p.updatedAt).toISOString(),
      label: p.outcome === "WIN" ? `Closed — WIN ${sign}$${Math.abs(pnl).toFixed(0)}`
           : p.outcome === "LOSS" ? `Closed — LOSS $${Math.abs(pnl).toFixed(0)}`
           : `Closed`,
      source: (p as { closeSource?: string | null }).closeSource ?? "agent",
      reason: null,
      pnl,
      pnlPct: Math.round(pnlPct * 10) / 10,
      outcome: p.outcome ?? null,
      analystName: p.analyst?.name ?? null,
      // Entry/exit so the feed can render "Bought N at $X, closed at $Y".
      shares: p.quantity,
      price: p.avgCost,
      closePrice: p.closePrice ?? undefined,
    });
  }

  // Management actions (non-close — the close is already represented above)
  for (const action of dbManagementActions) {
    if (action.actionType === "FULL_CLOSE") continue; // already shown as CLOSED
    let label = "Position updated";
    if (action.actionType === "PARTIAL_CLOSE") label = "Partial close";
    else if (action.actionType === "ADD_TO_POSITION") label = "Added to position";
    else if (action.actionType === "UPDATE_TARGETS") label = "Targets updated";
    else if (action.actionType === "MOVE_STOP_TO_BREAKEVEN") label = "Stop → breakeven";
    else if (action.actionType === "SET_TRAILING_STOP") label = "Trailing stop set";
    else if (action.actionType === "NEAR_TARGET") label = "Approaching target";
    else if (action.actionType === "NEAR_STOP") label = "Approaching stop";

    activityFeed.push({
      id: `action-${action.id}`,
      type: "MODIFIED",
      positionId: action.positionId,
      symbol: action.position.symbol,
      direction: action.position.direction,
      timestamp: action.createdAt.toISOString(),
      label,
      source: action.source,
      reason: action.reason,
      pnl: action.actionType === "PARTIAL_CLOSE" && action.fillPrice && action.fillQty
        ? action.position.direction === "LONG"
          ? (action.fillPrice - action.position.avgCost) * action.fillQty
          : (action.position.avgCost - action.fillPrice) * action.fillQty
        : null,
      pnlPct: null,
      outcome: null,
      analystName: action.position.analyst?.name ?? null,
    });
  }

  // Sort descending by timestamp, keep top 40
  activityFeed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const trimmedFeed = activityFeed.slice(0, 40);

  return {
    openTrades,
    pendingTrades,
    closedTrades,
    activityFeed: trimmedFeed,
    portfolio: {
      totalValue,
      unrealizedPnl,
      realizedPnl,
      winRate,
      openCount: openTrades.length,
      netPositionValue,
      positionMarketValue,
      longMarketValue,
      shortMarketValue,
      cash,
      buyingPower,
      usingMargin,
      leverageRatio,
      totalPnl,
      accountReturnPct,
      netContributed,
      dayPnl,
      dayPnlPct,
    },
    equityCurve,
    pnlCurve,
    realizedCurve,
    agentConfigs,
    recentRuns,
    todaysPicks,
    recentPicks,
    hasAlpacaKey: alpacaCreds !== undefined,
    analystCount: dbAgentConfigs.length,
    hasCompletedRun: dbRecentRuns.some((r) => r.status === "COMPLETE"),
    hasBrief: recentPicks.length > 0,
    analysts,
    analystEquityCurves,
    spyBenchmark,
    spyCandles,
  };
}
